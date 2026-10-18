// Single entry point: one bundle, one DB pool per worker. Each module registers
// its functions with the Functions host on import.
import './functions/health';
import './functions/auth';
import './functions/demo';
import './functions/me';
import './functions/public';
import './functions/passes';
import './functions/payments';
import './functions/gate';
import './functions/shop';
import './functions/adminMembers';
import './functions/console';
import './functions/timers';
