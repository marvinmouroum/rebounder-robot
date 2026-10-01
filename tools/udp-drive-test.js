/* =====================================================================
 *  udp-drive-test — Laptop-Testsender für die esp32-bridge
 * =====================================================================
 *  Voraussetzung: Laptop ist im WLAN "rebounder" (Passwort in der
 *  Firmware), ESP32-AP hat standardmäßig die IP 192.168.4.1.
 *
 *  Aufruf:
 *    node tools/udp-drive-test.js ping
 *        → RTT-Messung (10 Pings)
 *    node tools/udp-drive-test.js arm
 *        → sendet 1 s Neutral mit 30 Hz (armt die Firmware)
 *    node tools/udp-drive-test.js drive <steer_us> <throttle_us> [sekunden]
 *        → armt, hält dann das Kommando mit 30 Hz (Default 2 s), danach Neutral.
 *          Beispiel sanft vorwärts:  node tools/udp-drive-test.js drive 1500 1580 2
 *    node tools/udp-drive-test.js failsafe
 *        → armt, gibt 1 s Gas, stoppt dann ABRUPT das Senden.
 *          Erwartung: Räder stehen nach <250 ms (Watchdog-Abnahmetest,
 *          Auto dafür AUFBOCKEN!).
 * ===================================================================== */
'use strict';
const dgram = require('dgram');

const HOST = process.env.BRIDGE_HOST || '192.168.4.1';
const PORT = 4210, HZ = 30, NEUTRAL = 1500;
const sock = dgram.createSocket('udp4');
const send = s => sock.send(s, PORT, HOST);
const sleep = ms => new Promise(r => setTimeout(r, ms));

sock.on('message', msg => {
  const [, uptime, age] = String(msg).split(' ');
  if (pending) { pending(Date.now()); pending = null; }
  lastReply = { uptime: +uptime, age: +age };
});
let pending = null, lastReply = null;

async function holdCommand(steer, throttle, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { send(`c ${steer} ${throttle}`); await sleep(1000 / HZ); }
}

(async () => {
  const [mode, a1, a2, a3] = process.argv.slice(2);
  if (mode === 'ping') {
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      const rtt = await new Promise(res => { pending = t => res(t - t0); send('p'); setTimeout(() => res(-1), 500); });
      console.log(rtt < 0 ? 'timeout' : `RTT ${rtt} ms  (Firmware-Uptime ${lastReply?.uptime} ms)`);
      await sleep(200);
    }
  } else if (mode === 'arm') {
    console.log('Neutral 1 s (arming)…');
    await holdCommand(NEUTRAL, NEUTRAL, 1000);
    console.log('done — LED sollte dauerhaft leuchten.');
  } else if (mode === 'drive') {
    const steer = +a1 || NEUTRAL, throttle = +a2 || NEUTRAL, secs = +a3 || 2;
    console.log('Arming (1 s Neutral)…');
    await holdCommand(NEUTRAL, NEUTRAL, 1000);
    console.log(`Fahre: steer=${steer} throttle=${throttle} für ${secs}s`);
    await holdCommand(steer, throttle, secs * 1000);
    console.log('Neutral.');
    await holdCommand(NEUTRAL, NEUTRAL, 500);
  } else if (mode === 'failsafe') {
    console.log('AUTO AUFBOCKEN! Arming + 1 s Gas, dann Sende-Stopp…');
    await holdCommand(NEUTRAL, NEUTRAL, 1000);
    await holdCommand(NEUTRAL, 1600, 1000);
    console.log('Senden gestoppt — Räder müssen jetzt in <250 ms stehen.');
  } else {
    console.log('Modi: ping | arm | drive <steer_us> <throttle_us> [s] | failsafe');
  }
  sock.close();
})();
