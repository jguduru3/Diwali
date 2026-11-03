// Waits until a TCP port accepts connections (used so the Functions host starts after Azurite).
//   node scripts/wait-port.mjs 10000 [timeoutSeconds]
import { connect } from 'node:net';

const port = Number(process.argv[2]);
const deadline = Date.now() + Number(process.argv[3] ?? 60) * 1000;

function attempt() {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => {
    socket.end();
    process.exit(0);
  });
  socket.once('error', () => {
    if (Date.now() > deadline) {
      console.error(`Port ${port} did not open in time`);
      process.exit(1);
    }
    setTimeout(attempt, 300);
  });
}
attempt();
