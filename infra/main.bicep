// Diwali Express Pickup — Azure infrastructure (SPEC §11).
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
@description('L1 legal gate (SPEC_V3 §2): online ordering. Keep false until a written legal opinion clears it.')
param orderingEnabled bool = false
@description('Platform-fee payment adapter. "mock" is refused in prod; leave empty until an authorised provider adapter exists.')
param paymentProvider string = ''
@secure()
@minLength(32)
@description('Encrypts merchants\' YouPI-PG webhook secrets at rest.')
param merchantSecretsKey string
@description('Object id of the CI service principal (GitHub OIDC). Gets blob upload and secret read rights.')
param deployerPrincipalId string = ''

var isProd = env == 'prod'
var effectiveDemo = isProd ? false : demoMode
var effectiveOtpDev = isProd ? false : otpDevMode
var effectiveProvider = isProd ? paymentProvider : (empty(paymentProvider) ? 'mock' : paymentProvider)
var suffix = uniqueString(resourceGroup().id)
var tags = { app: 'diwali-express-pickup', env: env }

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
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
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
// so the app keeps a small pool (max 5) and Functions scale is capped below.
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
var secrets = {
  'DATABASE-URL': 'postgres://festive_app:${uriComponent(appDbPassword)}@${pgHost}:5432/festive'
  'MIGRATION-DATABASE-URL': 'postgres://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${pgHost}:5432/festive'
  'APP-DB-PASSWORD': appDbPassword
  'JWT-SECRET': jwtSecret
  'MERCHANT-SECRETS-KEY': merchantSecretsKey
  'MSG91-AUTH-KEY': empty(msg91AuthKey) ? 'not-set' : msg91AuthKey
  'MSG91-TEMPLATE-ID': empty(msg91TemplateId) ? 'not-set' : msg91TemplateId
}

resource vaultSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [
  for s in items(secrets): {
    parent: vault
    name: s.key
    properties: { value: s.value }
  }
]

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
        { name: 'OTP_DEV_MODE', value: string(effectiveOtpDev) }
        { name: 'DEMO_MODE', value: string(effectiveDemo) }
        { name: 'SEASON_END', value: seasonEnd }
        { name: 'STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'ORDERING_ENABLED', value: string(orderingEnabled) }
        { name: 'PAYMENT_PROVIDER', value: effectiveProvider }
        { name: 'MERCHANT_SECRETS_KEY', value: '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/MERCHANT-SECRETS-KEY)' }
        { name: 'PUBLIC_ORIGIN', value: empty(domain) ? '' : 'https://${domain}' }
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
      // B1ms Postgres allows ~50 connections; 8 instances × pool 5 stays under it.
      scaleAndConcurrency: { maximumInstanceCount: 8, instanceMemoryMB: 2048 }
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
    // no cacheConfiguration: API responses are never cached at the edge
  }
  dependsOn: [apiOrigin]
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
