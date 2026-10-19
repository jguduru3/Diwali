// Single entry point: one bundle, one DB pool per worker. Each module registers
// its functions with the Functions host on import.
import { assertConfig } from './lib/config';

import './functions/health';
import './functions/auth';
import './functions/demo';
import './functions/me';
import './functions/public';
import './functions/orders';
import './functions/media';
import './functions/payments';
import './functions/push';
import './functions/gate';
import './functions/shop';
import './functions/adminMembers';
import './functions/console';
import './functions/timers';

// In prod a missing secret or a test-only switch stops start-up (see lib/config.ts).
assertConfig();
