// Xpress Pickup — Azure infrastructure (SPEC §11).
// Deploy into an existing resource group:
//   az deployment group create -g rg-festive-<env> -f infra/main.bicep -p infra/params.<env>.json -p <secure params>
targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param env string
param location string = 'centralindia'
@description('Custom domain for Front Door, e.g. pickup.example.in. Leave empty to use the azurefd.net host.')
param domain string = ''
@description('Last day of the season (IST). Purge runs 90 days later.')
param seasonEnd string = '2026-11-20'
@description('One-tap demo sign-in and relaxed gate window. Forced off in prod.')
param demoMode bool = false
@description('OTP is always 123456 and never sent. Forced off in prod.')
param otpDevMode bool = false
param alertEmail string
param postgresAdminLogin string = 'festiveadmin'
@secure()
param postgresAdminPassword string
@secure()
@description('Password for the least-privilege app database role (created by the deploy workflow).')
param appDbPassword string
@secure()
@minLength(32)
param jwtSecret string
@secure()
param msg91AuthKey string = ''
param msg91TemplateId string = ''
@description('MSG91 Flow template (DLT-approved) for "your order changed" SMS, with variables shop, code, link.')
param msg91OrderChangedTemplateId string = ''
@description('Customer SMS: "msg91" sends, "log" only logs (never in production).')
param smsProvider string = env == 'prod' ? 'msg91' : 'log'
@description('Web push VAPID public key (npx web-push generate-vapid-keys). Empty = notifications off.')
param vapidPublicKey string = ''
@secure()
@description('Web push VAPID private key, kept in Key Vault.')
param vapidPrivateKey string = ''
@description('Masked shop → customer calls (G9): "exotel" places them, "off" hides the button, "log" only logs (never in prod). Empty: off in prod, log elsewhere.')
param callProvider string = ''
@description('Exotel account SID (Exotel dashboard → API settings).')
param exotelSid string = ''
@secure()
param exotelApiKey string = ''
@secure()
param exotelApiToken string = ''
@description('The ExoPhone customers see when the shop calls them.')
param exotelCallerId string = ''
@description('Exotel API host for the region of the account: api.exotel.com (Singapore) or api.in.exotel.com (Mumbai).')
param exotelApiHost string = 'api.exotel.com'
@description('Flat platform fee per order in paise (G3: 3000 = ₹30).')
param platformFeePaise int = 3000
@description('Minutes an order may wait for its platform fee before it is cancelled.')
param unpaidOrderTtlMinutes int = 60
@description('Minimum minutes between two "order changed" SMS for the same order.')
param orderChangedSmsGapMinutes int = 15
@description('L1 legal gate (SPEC_V3 §2): online ordering. Keep false until a written legal opinion clears it.')
param orderingEnabled bool = false
@description('Platform-fee payment adapter: "razorpay" (live), or "mock" outside prod only.')
param paymentProvider string = ''
@secure()
@description('Razorpay key ID (rzp_live_… in prod). Dashboard → Settings → API keys.')
param razorpayKeyId string = ''
@secure()
param razorpayKeySecret string = ''
@secure()
@description('Secret of the webhook pointed at https://<domain>/api/payments/webhook/razorpay.')
param razorpayWebhookSecret string = ''
@secure()
@minLength(32)
@description('Encrypts merchants\' YouPI-PG webhook secrets at rest.')
param merchantSecretsKey string
@description('Object id of the CI service principal (GitHub OIDC). Gets blob upload and secret read rights.')
param deployerPrincipalId string = ''

// ---- Capacity (defaults suit dev; params.prod.json sizes production for the season peak) ----
@description('PostgreSQL compute, e.g. Standard_B1ms (Burstable) or Standard_D8ds_v5 (GeneralPurpose).')
param postgresSkuName string = 'Standard_B1ms'
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param postgresTier string = 'Burstable'
@allowed(['Disabled', 'ZoneRedundant', 'SameZone'])
param postgresHighAvailability string = 'Disabled'
param postgresStorageGB int = 32
@description('Upper bound for Function App instances (Flex Consumption allows up to 1000).')
@minValue(1)
@maxValue(1000)
param functionMaxInstances int = 8
@description('Database connections per Function instance. Keep instances × pool under the server limit, or use PgBouncer (General Purpose and above).')
@minValue(1)
@maxValue(50)
param dbPoolMax int = 5
@description('Only when the web app is hosted on another domain than the API (e.g. https://app.example.in). Empty = same domain through Front Door (recommended).')
param webOrigins array = []
@description('Seconds a public catalogue list (shops, areas, price lists) is cached in each instance and at the edge.')
@minValue(0)
@maxValue(120)
param catalogueCacheSeconds int = 10

var isProd = env == 'prod'
var effectiveDemo = isProd ? false : demoMode
var effectiveOtpDev = isProd ? false : otpDevMode
var effectiveProvider = isProd ? paymentProvider : (empty(paymentProvider) ? 'mock' : paymentProvider)
// Calls: "log" is never allowed in prod; empty means off in prod and log elsewhere.
var effectiveCallProvider = empty(callProvider) || (isProd && callProvider == 'log') ? (isProd ? 'off' : 'log') : callProvider
var suffix = uniqueString(resourceGroup().id)
var tags = { app: 'xpress-pickup', env: env }
// PgBouncer (built into Flexible Server) is not offered on Burstable; with it the app connects
// on 6432 and many Function instances share a small set of server connections.
var usePgBouncer = postgresTier != 'Burstable'
var appDbPort = usePgBouncer ? '6432' : '5432'

// ---------------- Monitoring ----------------

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-festive-${env}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-festive-${env}'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-festive-${env}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'festive${env}'
    enabled: true
    emailReceivers: [{ name: 'owner', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

// ---------------- Storage (static website + private licence photos) ----------------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('stfestive${env}${suffix}', 24)
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false // the $web static site is served separately; everything else is private
    allowSharedKeyAccess: false // identity-only access (Functions, CI)
    defaultToOAuthAuthentication: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 7 } }
}

resource licencesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'licences'
  properties: { publicAccess: 'None' }
}

// Product photos. Served to customers through GET /api/media, so the container stays private.
resource shopMediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'shop-media'
  properties: { publicAccess: 'None' }
}

// Packed-order photos (proof of what was packed). Read only through the order APIs.
resource orderPhotosContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'order-photos'
  properties: { publicAccess: 'None' }
}

resource deploymentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'deployments'
  properties: { publicAccess: 'None' }
}

// ---------------- PostgreSQL Flexible Server ----------------

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-festive-${env}-${suffix}'
  location: location
  tags: tags
  sku: { name: postgresSkuName, tier: postgresTier }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: postgresStorageGB, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: isProd ? 35 : 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: postgresHighAvailability }
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'festive'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// TLS is required (default on; set explicitly). PgBouncer is not available on Burstable,
// so there the app keeps a small pool and Functions scale is capped (params).
resource pgBouncer 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = if (usePgBouncer) {
  parent: postgres
  name: 'pgbouncer.enabled'
  properties: { value: 'true', source: 'user-override' }
}

resource pgBouncerPoolMode 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = if (usePgBouncer) {
  parent: postgres
  name: 'pgbouncer.pool_mode'
  properties: { value: 'TRANSACTION', source: 'user-override' }
  dependsOn: [pgBouncer]
}

resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
}

resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// ---------------- Key Vault ----------------

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv-festive-${env}-${suffix}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enablePurgeProtection: isProd ? true : null
  }
}

var pgHost = postgres.properties.fullyQualifiedDomainName
// Secrets whose values are known before deployment. The two database URLs depend on the
// server's address, which exists only once it is created, so they are separate resources
// (a loop's keys must be known at the start of the deployment).
var secrets = {
  'APP-DB-PASSWORD': appDbPassword
  'JWT-SECRET': jwtSecret
  'MERCHANT-SECRETS-KEY': merchantSecretsKey
  'MSG91-AUTH-KEY': empty(msg91AuthKey) ? 'not-set' : msg91AuthKey
  'MSG91-TEMPLATE-ID': empty(msg91TemplateId) ? 'not-set' : msg91TemplateId
  'MSG91-ORDER-CHANGED-TEMPLATE-ID': empty(msg91OrderChangedTemplateId) ? 'not-set' : msg91OrderChangedTemplateId
  'RAZORPAY-KEY-ID': empty(razorpayKeyId) ? 'not-set' : razorpayKeyId
  'RAZORPAY-KEY-SECRET': empty(razorpayKeySecret) ? 'not-set' : razorpayKeySecret
  'RAZORPAY-WEBHOOK-SECRET': empty(razorpayWebhookSecret) ? 'not-set' : razorpayWebhookSecret
  'EXOTEL-API-KEY': empty(exotelApiKey) ? 'not-set' : exotelApiKey
  'EXOTEL-API-TOKEN': empty(exotelApiToken) ? 'not-set' : exotelApiToken
  'VAPID-PRIVATE-KEY': empty(vapidPrivateKey) ? 'not-set' : vapidPrivateKey
}

resource vaultSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [
  for s in items(secrets): {
    parent: vault
    name: s.key
    properties: { value: s.value }
  }
]

// The app goes through PgBouncer where available; migrations always connect directly.
resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'DATABASE-URL'
  properties: {
    value: 'postgres://festive_app:${uriComponent(appDbPassword)}@${pgHost}:${appDbPort}/festive'
  }
}

resource migrationUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'MIGRATION-DATABASE-URL'
  properties: {
    value: 'postgres://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${pgHost}:5432/festive'
  }
}

var vaultUri = vault.properties.vaultUri

// ---------------- Functions (Flex Consumption, Node 20) ----------------

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-festive-${env}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

resource frontDoor 'Microsoft.Cdn/profiles@2024-02-01' = {
  name: 'afd-festive-${env}'
  location: 'global'
  tags: tags
  sku: { name: 'Standard_AzureFrontDoor' }
}

resource func 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-festive-${env}-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      // Cross-origin calls (with the session cookie) only from the configured web origins.
      cors: empty(webOrigins) ? null : { allowedOrigins: webOrigins, supportCredentials: true }
      // Only Front Door (this profile) may call the API.
      ipSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: [
        {
          name: 'FrontDoor'
          action: 'Allow'
          priority: 100
          tag: 'ServiceTag'
          ipAddress: 'AzureFrontDoor.Backend'
          headers: { 'x-azure-fdid': [frontDoor.properties.frontDoorId] }
        }
      ]
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'APP_ENV', value: env }
        { name: 'DATABASE_URL', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/DATABASE-URL)' }
        { name: 'JWT_SECRET', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/JWT-SECRET)' }
        { name: 'MSG91_AUTH_KEY', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/MSG91-AUTH-KEY)' }
        { name: 'MSG91_TEMPLATE_ID', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/MSG91-TEMPLATE-ID)' }
        { name: 'MSG91_ORDER_CHANGED_TEMPLATE_ID', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/MSG91-ORDER-CHANGED-TEMPLATE-ID)' }
        { name: 'SMS_PROVIDER', value: smsProvider }
        { name: 'PLATFORM_FEE_PAISE', value: string(platformFeePaise) }
        { name: 'UNPAID_ORDER_TTL_MINUTES', value: string(unpaidOrderTtlMinutes) }
        { name: 'ORDER_CHANGED_SMS_GAP_MINUTES', value: string(orderChangedSmsGapMinutes) }
        { name: 'OTP_DEV_MODE', value: string(effectiveOtpDev) }
        { name: 'DEMO_MODE', value: string(effectiveDemo) }
        { name: 'SEASON_END', value: seasonEnd }
        { name: 'STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'ORDERING_ENABLED', value: string(orderingEnabled) }
        { name: 'PAYMENT_PROVIDER', value: effectiveProvider }
        { name: 'RAZORPAY_KEY_ID', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/RAZORPAY-KEY-ID)' }
        { name: 'RAZORPAY_KEY_SECRET', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/RAZORPAY-KEY-SECRET)' }
        { name: 'RAZORPAY_WEBHOOK_SECRET', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/RAZORPAY-WEBHOOK-SECRET)' }
        { name: 'MERCHANT_SECRETS_KEY', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/MERCHANT-SECRETS-KEY)' }
        // Web push: off until both VAPID keys are set (checked by /api/health in prod).
        { name: 'VAPID_PUBLIC_KEY', value: vapidPublicKey }
        { name: 'VAPID_PRIVATE_KEY', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/VAPID-PRIVATE-KEY)' }
        // Masked calls: the button stays hidden until Exotel and both keys are set.
        { name: 'CALL_PROVIDER', value: effectiveCallProvider }
        { name: 'EXOTEL_SID', value: empty(exotelSid) ? 'not-set' : exotelSid }
        { name: 'EXOTEL_API_KEY', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/EXOTEL-API-KEY)' }
        { name: 'EXOTEL_API_TOKEN', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/EXOTEL-API-TOKEN)' }
        { name: 'EXOTEL_CALLER_ID', value: empty(exotelCallerId) ? 'not-set' : exotelCallerId }
        { name: 'EXOTEL_API_HOST', value: exotelApiHost }
        // Links and payment return URLs: the custom domain, or the Front Door address until one is set.
        { name: 'PUBLIC_ORIGIN', value: 'https://${empty(domain) ? endpoint.properties.hostName : domain}' }
        { name: 'DB_POOL_MAX', value: string(dbPoolMax) }
        // A frontend on another site needs cross-site session cookies (Secure; SameSite=None).
        { name: 'COOKIE_SAMESITE', value: empty(webOrigins) ? 'Lax' : 'None' }
        { name: 'CATALOGUE_CACHE_SECONDS', value: string(catalogueCacheSeconds) }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deployments'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      // Without PgBouncer keep functionMaxInstances × dbPoolMax under the server's connections
      // (B1ms ≈ 50: 8 × 5). With PgBouncer the pooler multiplexes them.
      scaleAndConcurrency: { maximumInstanceCount: functionMaxInstances, instanceMemoryMB: 2048 }
      runtime: { name: 'node', version: '20' }
    }
  }
  dependsOn: [deploymentsContainer]
}

// Role assignments for the Function App identity.
var roles = {
  blobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  queueDataContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  tableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
}

resource funcStorageRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for r in [roles.blobDataOwner, roles.queueDataContributor, roles.tableDataContributor]: {
    scope: storage
    name: guid(storage.id, func.id, r)
    properties: {
      principalId: func.identity.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', r)
    }
  }
]

resource funcVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, func.id, roles.kvSecretsUser)
  properties: {
    principalId: func.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser)
  }
}

resource deployerRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for r in (empty(deployerPrincipalId) ? [] : [roles.blobDataOwner]): {
    scope: storage
    name: guid(storage.id, deployerPrincipalId, r)
    properties: {
      principalId: deployerPrincipalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', r)
    }
  }
]

resource deployerVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  scope: vault
  name: guid(vault.id, deployerPrincipalId, roles.kvSecretsUser)
  properties: {
    principalId: deployerPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser)
  }
}

// ---------------- Front Door: /api/* → Functions, /* → static website ----------------

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = {
  parent: frontDoor
  name: 'festive-${env}-${suffix}'
  location: 'global'
  properties: { enabledState: 'Enabled' }
}

var webHost = replace(replace(storage.properties.primaryEndpoints.web, 'https://', ''), '/', '')

resource webGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: frontDoor
  name: 'web'
  properties: {
    loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3 }
    healthProbeSettings: { probePath: '/index.html', probeRequestType: 'HEAD', probeProtocol: 'Https', probeIntervalInSeconds: 120 }
  }
}

resource webOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: webGroup
  name: 'storage'
  properties: {
    hostName: webHost
    originHostHeader: webHost
    httpsPort: 443
    priority: 1
    weight: 1000
    enforceCertificateNameCheck: true
  }
}

resource apiGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: frontDoor
  name: 'api'
  properties: {
    loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3 }
    healthProbeSettings: { probePath: '/api/health', probeRequestType: 'GET', probeProtocol: 'Https', probeIntervalInSeconds: 120 }
  }
}

resource apiOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: apiGroup
  name: 'functions'
  properties: {
    hostName: func.properties.defaultHostName
    originHostHeader: func.properties.defaultHostName
    httpsPort: 443
    priority: 1
    weight: 1000
    enforceCertificateNameCheck: true
  }
}

resource ruleSet 'Microsoft.Cdn/profiles/ruleSets@2024-02-01' = {
  parent: frontDoor
  name: 'webrules'
}

var csp = 'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com; img-src \'self\' data: blob: https://*.tile.openstreetmap.org; connect-src \'self\' https://*.tile.openstreetmap.org; worker-src \'self\'; manifest-src \'self\'; frame-ancestors \'none\'; base-uri \'self\'; form-action \'self\''
var securityHeaders = {
  'Content-Security-Policy': csp
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
  'X-Content-Type-Options': 'nosniff'
  'Referrer-Policy': 'strict-origin-when-cross-origin'
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=()'
}

resource headersRule 'Microsoft.Cdn/profiles/ruleSets/rules@2024-02-01' = {
  parent: ruleSet
  name: 'securityheaders'
  properties: {
    order: 1
    conditions: []
    actions: [
      for h in items(securityHeaders): {
        name: 'ModifyResponseHeader'
        parameters: {
          typeName: 'DeliveryRuleHeaderActionParameters'
          headerAction: 'Overwrite'
          headerName: h.key
          value: h.value
        }
      }
    ]
    matchProcessingBehavior: 'Continue'
  }
}

// SPA routing: paths without a file extension get index.html (200, not the storage 404 page).
resource spaRule 'Microsoft.Cdn/profiles/ruleSets/rules@2024-02-01' = {
  parent: ruleSet
  name: 'spafallback'
  properties: {
    order: 2
    conditions: [
      {
        name: 'UrlFileExtension'
        parameters: {
          typeName: 'DeliveryRuleUrlFileExtensionMatchConditionParameters'
          operator: 'Any'
          negateCondition: true
          matchValues: []
          transforms: []
        }
      }
    ]
    actions: [
      {
        name: 'UrlRewrite'
        parameters: {
          typeName: 'DeliveryRuleUrlRewriteActionParameters'
          sourcePattern: '/'
          destination: '/index.html'
          preserveUnmatchedPath: false
        }
      }
    ]
    matchProcessingBehavior: 'Continue'
  }
  dependsOn: [headersRule]
}

resource customDomain 'Microsoft.Cdn/profiles/customDomains@2024-02-01' = if (!empty(domain)) {
  parent: frontDoor
  name: replace(domain, '.', '-')
  properties: {
    hostName: domain
    tlsSettings: { certificateType: 'ManagedCertificate', minimumTlsVersion: 'TLS12' }
  }
}

var customDomains = empty(domain) ? [] : [{ id: customDomain.id }]

// Public catalogue (shop list, areas, shop page, price list): the same for every customer, so
// Front Door serves it from the edge for the few seconds the API allows (Cache-Control public,
// ETag). At peak this is most of the traffic; the origin then sees about one request per URL per
// cache window. Responses marked private (a shop list with the caller's location) are not kept.
resource catalogueRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'catalogue'
  properties: {
    originGroup: { id: apiGroup.id }
    customDomains: customDomains
    patternsToMatch: ['/api/areas', '/api/shops', '/api/shops/*']
    supportedProtocols: ['Https', 'Http']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'UseQueryString'
      compressionSettings: {
        isCompressionEnabled: true
        contentTypesToCompress: ['application/json']
      }
    }
  }
  dependsOn: [apiOrigin]
}

resource apiRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'api'
  properties: {
    originGroup: { id: apiGroup.id }
    customDomains: customDomains
    patternsToMatch: ['/api/*']
    supportedProtocols: ['Https', 'Http']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    // no cacheConfiguration: everything else under /api (accounts, orders, shop staff, admin)
    // is never cached at the edge; the API also marks it Cache-Control: no-store.
  }
  dependsOn: [apiOrigin, catalogueRoute]
}

resource webRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'web'
  properties: {
    originGroup: { id: webGroup.id }
    customDomains: customDomains
    ruleSets: [{ id: ruleSet.id }]
    patternsToMatch: ['/*']
    supportedProtocols: ['Https', 'Http']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    cacheConfiguration: {
      // Honours the Cache-Control set at upload: hashed assets immutable, index.html/sw.js no-cache.
      queryStringCachingBehavior: 'IgnoreQueryString'
      compressionSettings: {
        isCompressionEnabled: true
        contentTypesToCompress: ['text/html', 'text/css', 'application/javascript', 'application/json', 'image/svg+xml', 'application/manifest+json']
      }
    }
  }
  dependsOn: [webOrigin, apiRoute, spaRule]
}

// ---------------- Alerts ----------------

resource alert5xx 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-festive-${env}-api-5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'API returned server errors'
    severity: 2
    enabled: true
    scopes: [func.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'http5xx'
          metricName: 'Http5xx'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource alertPgCpu 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-festive-${env}-pg-cpu'
  location: 'global'
  tags: tags
  properties: {
    description: 'Postgres CPU above 80%'
    severity: 2
    enabled: true
    scopes: [postgres.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'cpu'
          metricName: 'cpu_percent'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

var healthUrl = 'https://${empty(domain) ? endpoint.properties.hostName : domain}/api/health'

resource healthTest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: 'webtest-festive-${env}-health'
  location: location
  tags: union(tags, { 'hidden-link:${insights.id}': 'Resource' })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: 'webtest-festive-${env}-health'
    Name: 'API health'
    Enabled: true
    Frequency: 300
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [{ Id: 'apac-sg-sin-azr' }, { Id: 'apac-hk-hkn-azr' }, { Id: 'emea-nl-ams-azr' }]
    Request: { RequestUrl: healthUrl, HttpVerb: 'GET', ParseDependentRequests: false }
    ValidationRules: { ExpectedHttpStatusCode: 200, SSLCheck: true, SSLCertRemainingLifetimeCheck: 7 }
  }
}

resource alertHealth 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-festive-${env}-health'
  location: 'global'
  tags: tags
  properties: {
    description: '/api/health failing'
    severity: 1
    enabled: true
    scopes: [healthTest.id, insights.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: healthTest.id
      componentId: insights.id
      failedLocationCount: 2
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

// ---------------- Outputs (used by the deploy workflow) ----------------

output storageAccountName string = storage.name
output functionAppName string = func.name
output keyVaultName string = vault.name
output postgresServerName string = postgres.name
output frontDoorProfileName string = frontDoor.name
output frontDoorEndpointName string = endpoint.name
output publicUrl string = 'https://${empty(domain) ? endpoint.properties.hostName : domain}'
output customDomainValidationToken string = empty(domain) ? '' : customDomain.properties.validationProperties.validationToken
