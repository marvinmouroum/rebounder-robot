/* =====================================================================
 *  esp32-bridge — Funkbrücke des Rebounders (Bauabschnitt 0/2)
 * =====================================================================
 *  Der ESP32 macht einen WLAN-Access-Point auf und nimmt UDP-Kommandos
 *  (iPhone-App oder tools/udp-drive-test.js) entgegen. Er erzeugt daraus
 *  zwei 50-Hz-RC-PWM-Signale (Lenkservo + ESC) und überwacht die
 *  Verbindung: >200 ms ohne gültiges Kommando ⇒ Neutral (Failsafe).
 *
 *  Protokoll (ASCII, ein Datagramm pro Kommando):
 *      "c <steer_us> <throttle_us>"   z. B. "c 1500 1560"
 *      "p"                            Ping — Antwort "a <uptime_ms> <age_ms>"
 *  Antwort auf jedes c-Kommando: "a <uptime_ms> 0" (für RTT-Messung).
 *
 *  Sicherheit:
 *   - ARMING: Nach Boot/Failsafe werden Gas-Kommandos erst akzeptiert,
 *     wenn 20 aufeinanderfolgende Kommandos Neutral-Gas (±30 µs) waren.
 *     Verhindert Losfahren mit altem Sollwert nach Reconnect.
 *   - Clamps: Lenkung/Gas hart auf [1000, 2000] µs begrenzt; Gas
 *     zusätzlich per THROTTLE_FWD_MAX/REV_MAX gedrosselt (zum Einfahren
 *     klein lassen!).
 *
 *  Verkabelung (siehe .okf/hardware/build-guide.md):
 *   - GPIO 18 → Servo-Signal (weiß/orange), GPIO 19 → ESC-Signal
 *   - GND gemeinsam mit ESC/Servo; ESP32-5V über Mini-Buck am BEC.
 *   - NIE die rote BEC-Leitung an einen GPIO!
 * ===================================================================== */

#include <WiFi.h>
#include <WiFiUdp.h>

/* ---------- Konfiguration ---------- */
static const char* AP_SSID = "rebounder";
static const char* AP_PASS = AP_PASS_PLACEHOLDER;  // set locally, not committed
static const uint16_t UDP_PORT = 4210;

static const int PIN_STEER = 18;
static const int PIN_ESC   = 19;
static const int PIN_LED   = 2;                  // Onboard-LED: Status

static const uint32_t FAILSAFE_MS = 200;         // ohne Kommando ⇒ Neutral
static const int NEUTRAL_US = 1500;
static const int US_MIN = 1000, US_MAX = 2000;

// Zum Einfahren klein lassen! (±80 µs ≈ Schrittgeschwindigkeit)
static int THROTTLE_FWD_MAX = 1650;
static int THROTTLE_REV_MAX = 1350;
static int STEER_MIN = 1100, STEER_MAX = 1900;   // Endanschläge einmessen

static const int ARM_NEUTRAL_COUNT = 20;         // Neutral-Kommandos bis "armed"
static const int ARM_NEUTRAL_TOL = 30;           // µs

/* ---------- LEDC: 50-Hz-RC-PWM ---------- */
static const int LEDC_FREQ = 50;
static const int LEDC_RES_BITS = 16;             // 65535 ≙ 20 ms

static void writeUs(int pin, int us) {
  // us → Duty bei 50 Hz / 16 Bit: duty = us / 20000 * 65535
  uint32_t duty = (uint32_t)((uint64_t)us * ((1 << LEDC_RES_BITS) - 1) / 20000ULL);
  ledcWrite(pin, duty);
}

/* ---------- Zustand ---------- */
WiFiUDP udp;
uint32_t lastCmdMs = 0;
bool armed = false;
int neutralStreak = 0;
int curSteer = NEUTRAL_US, curThrottle = NEUTRAL_US;

static int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

static void applyNeutral() {
  curSteer = NEUTRAL_US;
  curThrottle = NEUTRAL_US;
  writeUs(PIN_STEER, NEUTRAL_US);
  writeUs(PIN_ESC, NEUTRAL_US);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);

  ledcAttach(PIN_STEER, LEDC_FREQ, LEDC_RES_BITS);   // Arduino-ESP32 Core 3.x
  ledcAttach(PIN_ESC, LEDC_FREQ, LEDC_RES_BITS);
  applyNeutral();                                    // ESC sieht ab Boot Neutral

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  udp.begin(UDP_PORT);
  Serial.printf("AP '%s' auf %s, UDP-Port %u\n",
                AP_SSID, WiFi.softAPIP().toString().c_str(), UDP_PORT);
}

void loop() {
  const uint32_t now = millis();

  /* ---- Empfangen ---- */
  int sz = udp.parsePacket();
  if (sz > 0) {
    char buf[64];
    int n = udp.read(buf, sizeof(buf) - 1);
    buf[n > 0 ? n : 0] = '\0';

    if (buf[0] == 'c') {
      int st = NEUTRAL_US, th = NEUTRAL_US;
      if (sscanf(buf, "c %d %d", &st, &th) == 2) {
        st = clampi(clampi(st, US_MIN, US_MAX), STEER_MIN, STEER_MAX);
        th = clampi(clampi(th, US_MIN, US_MAX), THROTTLE_REV_MAX, THROTTLE_FWD_MAX);

        // ARMING: erst Neutral-Gas sehen, dann Gas freigeben
        if (!armed) {
          if (abs(th - NEUTRAL_US) <= ARM_NEUTRAL_TOL) {
            if (++neutralStreak >= ARM_NEUTRAL_COUNT) {
              armed = true;
              Serial.println("ARMED");
            }
          } else neutralStreak = 0;
          th = NEUTRAL_US;                         // bis dahin: kein Gas
        }

        curSteer = st;
        curThrottle = th;
        writeUs(PIN_STEER, curSteer);
        writeUs(PIN_ESC, curThrottle);
        lastCmdMs = now;

        char rep[32];
        int rn = snprintf(rep, sizeof(rep), "a %lu 0", (unsigned long)now);
        udp.beginPacket(udp.remoteIP(), udp.remotePort());
        udp.write((const uint8_t*)rep, rn);
        udp.endPacket();
      }
    } else if (buf[0] == 'p') {
      char rep[48];
      int rn = snprintf(rep, sizeof(rep), "a %lu %lu",
                        (unsigned long)now, (unsigned long)(now - lastCmdMs));
      udp.beginPacket(udp.remoteIP(), udp.remotePort());
      udp.write((const uint8_t*)rep, rn);
      udp.endPacket();
    }
  }

  /* ---- Failsafe-Watchdog ---- */
  if (now - lastCmdMs > FAILSAFE_MS) {
    if (armed) Serial.println("FAILSAFE -> Neutral, disarmed");
    applyNeutral();
    armed = false;
    neutralStreak = 0;
  }

  /* ---- Status-LED: aus = Failsafe, an = armed, blinkt = verbunden/unarmed ---- */
  if (armed) digitalWrite(PIN_LED, HIGH);
  else if (now - lastCmdMs <= FAILSAFE_MS) digitalWrite(PIN_LED, (now / 250) % 2);
  else digitalWrite(PIN_LED, LOW);

  delay(2);
}
