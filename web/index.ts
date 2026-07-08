import { Temporal } from 'temporal-polyfill';

declare global {
  interface Window {
    INITIAL_SERVER_TIME: number;
    WEB_TRANSPORT_PORT: number;
    WEB_TRANSPORT_CERT: string;
  }
}

type SVGElementInHTML = HTMLElement & SVGSVGElement;
type GElementInHTML = HTMLElement & SVGGElement;

const kNetworkModeKey = 'network-mode';
const kShowAnalogKey = 'show-analog';
const kShowDigitalKey = 'show-digital';
const kShowStatsKey = 'show-stats';

let timeOrigin = window.INITIAL_SERVER_TIME - window.PAGE_LOAD_TIME;
let lastWorkerDataTime: number | null = null;
let lastSyncRequest = -Infinity;
let postToWorker: (msg: object) => void;

const delayDisplay = document.getElementById('delay') as HTMLElement;
const offsetDisplay = document.getElementById('offset') as HTMLElement;
const modeDisplay = document.getElementById('mode') as HTMLElement;

function handleWorkerMessage(event: MessageEvent) {
  if (event.data.delay !== undefined) {
    delayDisplay.textContent = event.data.delay.toFixed(2);
  }
  if (event.data.offset !== undefined) {
    offsetDisplay.textContent = event.data.offset;
  }
  if (event.data.mode !== undefined) {
    modeDisplay.textContent = event.data.mode;
  }
  if (event.data.timeOriginOffset !== undefined) {
    timeOrigin = performance.timeOrigin - event.data.timeOriginOffset;
    lastWorkerDataTime = performance.now();
  }
}

const modeSelect = document.getElementById('network-mode') as HTMLSelectElement;
modeSelect.value = localStorage.getItem(kNetworkModeKey) ?? 'Auto';

window.addEventListener('storage', (event) => {
  if (event.key === kNetworkModeKey) {
    modeSelect.value = event.newValue ?? 'Auto';
  }
});

modeSelect.addEventListener('change', () => {
  localStorage.setItem(kNetworkModeKey, modeSelect.value);
  postToWorker({ mode: modeSelect.value });
});

const workerConfig = {
  webTransportPort: window.WEB_TRANSPORT_PORT,
  webTransportCert: window.WEB_TRANSPORT_CERT,
  mode: modeSelect.value,
};
if (typeof SharedWorker !== 'undefined') {
  const sharedWorker = new SharedWorker(new URL('./worker.js', import.meta.url));
  sharedWorker.port.start();
  sharedWorker.port.postMessage(workerConfig);
  sharedWorker.port.onmessage = handleWorkerMessage;
  postToWorker = (msg) => sharedWorker.port.postMessage(msg);
} else {
  const worker = new Worker(new URL('./worker.js', import.meta.url));
  worker.postMessage(workerConfig);
  worker.onmessage = handleWorkerMessage;
  postToWorker = (msg) => worker.postMessage(msg);
}

const clockEmoji = ['🕛', '🕧', '🕐', '🕜', '🕑', '🕝', '🕒', '🕞',
  '🕓', '🕟', '🕔', '🕠', '🕕', '🕡', '🕖', '🕣', '🕗', '🕢', '🕘',
  '🕤', '🕙', '🕥', '🕚', '🕦'];

const clock = document.getElementById('clock') as SVGElementInHTML;
const hourHand = document.getElementById('hour-hand') as GElementInHTML;
const minuteHand = document.getElementById('minute-hand') as GElementInHTML;
const secondHand = document.getElementById('second-hand') as GElementInHTML;

const hourTransform = clock.createSVGTransform();
hourHand.transform.baseVal.initialize(hourTransform);
const minuteTransform = clock.createSVGTransform();
minuteHand.transform.baseVal.initialize(minuteTransform);
const secondTransform = clock.createSVGTransform();
secondHand.transform.baseVal.initialize(secondTransform);

const time = document.getElementById('time') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const showAnalogCheckbox = document.getElementById('show-analog') as HTMLInputElement;
const showDigitalCheckbox = document.getElementById('show-digital') as HTMLInputElement;
const showStatsCheckbox = document.getElementById('show-stats') as HTMLInputElement;
const fullscreenCheckbox = document.getElementById('fullscreen') as HTMLInputElement;
const timezoneSelect = document.getElementById('timezone') as HTMLSelectElement;

if (typeof Intl.supportedValuesOf === 'function') {
  const timeZones = Intl.supportedValuesOf('timeZone');
  // Workaround for inconsistent implementations across Javascript engines.
  // https://github.com/tc39/ecma402/issues/778
  if (!timeZones.includes('UTC')) {
    timeZones.push('UTC');
    timeZones.sort();
  }
  for (const tz of timeZones) {
    const option = document.createElement('option');
    option.value = tz;
    option.textContent = tz;
    timezoneSelect.appendChild(option);
  }
  timezoneSelect.value = Temporal.Now.timeZoneId();
}

if (!JSON.parse(localStorage.getItem(kShowAnalogKey) ?? 'true')) {
  showAnalogCheckbox.checked = false;
  clock.classList.add('hidden');
}
if (!JSON.parse(localStorage.getItem(kShowDigitalKey) ?? 'true')) {
  showDigitalCheckbox.checked = false;
  time.classList.add('hidden');
}
if (!JSON.parse(localStorage.getItem(kShowStatsKey) ?? 'true')) {
  showStatsCheckbox.checked = false;
  status.classList.add('hidden');
}

const params = new URLSearchParams(window.location.search);
const tzParam = params.get('tz');
if (tzParam) {
  timezoneSelect.value = tzParam;
}

let lastTime = '??:??:??.?';
let lastEmojiIndex = -1;
let currentTimeZone = Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timezoneSelect.value);

function updateTime() {
  const now = performance.now();
  const timeSinceData = lastWorkerDataTime !== null ? now - lastWorkerDataTime : now - window.PAGE_LOAD_TIME;
  const syncThreshold = lastWorkerDataTime !== null ? 70_000 : 5_000;
  if (timeSinceData > syncThreshold && now - lastSyncRequest > 10_000) {
    lastSyncRequest = now;
    postToWorker({ sync: true });
  }

  const nowInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(now + timeOrigin));
  const zonedDateTime = nowInstant.toZonedDateTimeISO(currentTimeZone);

  if (showDigitalCheckbox.checked) {
    const hoursStr = zonedDateTime.hour.toString().padStart(2, '0');
    const minutesStr = zonedDateTime.minute.toString().padStart(2, '0');
    const secondsStr = zonedDateTime.second.toString().padStart(2, '0');
    const tenths = Math.floor(zonedDateTime.millisecond / 100).toString();
    const newTime = `${hoursStr}:${minutesStr}:${secondsStr}.${tenths}`;
    if (newTime !== lastTime) {
      time.textContent = lastTime = newTime;
    }
  }

  const emojiIndex = (zonedDateTime.hour % 12) * 2 + Math.floor(zonedDateTime.minute / 30);
  if (emojiIndex !== lastEmojiIndex) {
    document.title = `🦊${clockEmoji[emojiIndex]}`;
    lastEmojiIndex = emojiIndex;
  }

  if (showAnalogCheckbox.checked) {
    let total = 1000;
    let accumulator = zonedDateTime.second * total + zonedDateTime.millisecond;
    total *= 60;
    secondTransform.setRotate((accumulator * 360) / total, 50, 50);
    accumulator += zonedDateTime.minute * total;
    total *= 60;
    minuteTransform.setRotate((accumulator * 360) / total, 50, 50);
    accumulator += zonedDateTime.hour * total;
    total *= 12;
    hourTransform.setRotate((accumulator * 360) / total, 50, 50);
  }

  requestAnimationFrame(updateTime);
}
updateTime();

if (navigator.wakeLock?.request) {
  const toggle = document.getElementById('enable-wake-lock') as HTMLInputElement;
  let wakeLock: WakeLockSentinel | null = null;
  toggle.addEventListener('change', async () => {
    if (toggle.checked && !wakeLock) {
      toggle.disabled = true;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.onrelease = () => {
          toggle.checked = false;
          wakeLock = null;
        }
      } catch (e) {
        console.error("Failed to acquire wake lock!", e);
      } finally {
        toggle.disabled = false;
      }
    } else if (!toggle.checked && wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  });
} else {
  document.getElementById('enable-wake-lock')?.remove();
}

const pageContent = document.getElementById('content') as HTMLElement;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
pageContent.addEventListener('click', () => {
  if (settingsDialog.open) {
    settingsDialog.close();
  } else {
    settingsDialog.showModal();
  }
});
settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) {
    settingsDialog.close();
  }
});

showAnalogCheckbox.addEventListener('change', () => {
  localStorage.setItem(kShowAnalogKey, JSON.stringify(showAnalogCheckbox.checked));
  if (showAnalogCheckbox.checked) {
    clock.classList.remove('hidden');
  } else {
    clock.classList.add('hidden');
  }
});

showDigitalCheckbox.addEventListener('change', () => {
  localStorage.setItem(kShowDigitalKey, JSON.stringify(showDigitalCheckbox.checked));
  if (showDigitalCheckbox.checked) {
    time.classList.remove('hidden');
  } else {
    time.classList.add('hidden');
  }
});

showStatsCheckbox.addEventListener('change', () => {
  localStorage.setItem(kShowStatsKey, JSON.stringify(showStatsCheckbox.checked));
  if (showStatsCheckbox.checked) {
    status.classList.remove('hidden');
  } else {
    status.classList.add('hidden');
  }
});

timezoneSelect.addEventListener('change', () => {
  currentTimeZone = Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timezoneSelect.value);

  if (timezoneSelect.value !== Temporal.Now.timeZoneId()) {
    params.set('tz', timezoneSelect.value);
  } else {
    params.delete('tz');
  }

  const newSearch = params.toString();
  const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
  if (window.location.search !== (newSearch ? '?' + newSearch : '')) {
    window.history.replaceState({}, '', newUrl);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'f') {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  } else if (event.key === 's') {
    settingsDialog.showModal();
  }
});

if (document.fullscreenElement) {
  fullscreenCheckbox.checked = true;
}
fullscreenCheckbox.addEventListener('change', () => {
  if (fullscreenCheckbox.checked) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenCheckbox.checked = !!document.fullscreenElement;
});
