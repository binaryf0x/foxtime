import { Temporal } from 'temporal-polyfill';

declare global {
  interface Window {
    PAGE_LOAD_TIME: number;
    INITIAL_SERVER_TIME: number;
    WEB_TRANSPORT_PORT: number;
    WEB_TRANSPORT_CERT: string;
  }
}

const kNetworkModeKey = 'network-mode';
const kShowStatsKey = 'show-stats';

let timeOrigin = window.INITIAL_SERVER_TIME - window.PAGE_LOAD_TIME;
let targetInstant: Temporal.Instant | null = null;
let lastTimeText = '';
let lastDaysText = '';
let animationFrameId: number | null = null;

let lastWorkerDataTime: number | null = null;
let lastSyncRequest = -Infinity;
let postToWorker: (msg: object) => void;

const delayDisplay = document.getElementById('delay') as HTMLElement;
const offsetDisplay = document.getElementById('offset') as HTMLElement;
const modeDisplay = document.getElementById('mode') as HTMLElement;
const timeDisplay = document.getElementById('time') as HTMLElement;
const daysDisplay = document.getElementById('days') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const showStatsCheckbox = document.getElementById('show-stats') as HTMLInputElement;
const fullscreenCheckbox = document.getElementById('fullscreen') as HTMLInputElement;
const timezoneSelect = document.getElementById('timezone') as HTMLSelectElement;
const targetTimeInput = document.getElementById('target-time') as HTMLInputElement;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const pageContent = document.getElementById('content') as HTMLElement;

function updateUrl() {
  if (targetInstant) {
    params.set('t', (targetInstant.epochMilliseconds / 1000).toString());
  } else {
    params.delete('t');
  }

  const newSearch = params.toString();
  const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
  if (window.location.search !== (newSearch ? '?' + newSearch : '')) {
    window.history.replaceState({}, '', newUrl);
  }
}

function updateTime() {
  animationFrameId = null;

  const now = performance.now();
  const timeSinceData = lastWorkerDataTime !== null ? now - lastWorkerDataTime : now - window.PAGE_LOAD_TIME;
  const syncThreshold = lastWorkerDataTime !== null ? 70_000 : 5_000;
  if (timeSinceData > syncThreshold && now - lastSyncRequest > 10_000) {
    lastSyncRequest = now;
    postToWorker({ sync: true });
  }

  if (!targetInstant) {
    daysDisplay.textContent = lastDaysText = "";
    timeDisplay.textContent = lastTimeText = "??:??:??.?";
    return;
  }

  const nowInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(now + timeOrigin));
  let shouldContinue = false;

  let diff = targetInstant.epochMilliseconds - nowInstant.epochMilliseconds;
  if (diff <= 0) {
    diff = 0;
  } else {
    shouldContinue = true;
  }

  const tenths = Math.floor((diff % 1000) / 100);
  let seconds = Math.floor(diff / 1000);
  let minutes = Math.floor(seconds / 60);
  seconds %= 60;
  let hours = Math.floor(minutes / 60);
  minutes %= 60;
  const days = Math.floor(hours / 24);
  hours %= 24;

  let daysText = '';
  let timeText;
  if (days > 0) {
    daysText = `${days} ${days === 1 ? 'day' : 'days'}`;
    timeText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`;
  } else if (hours > 0) {
    timeText = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`;
  } else if (minutes > 0) {
    timeText = `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
  } else {
    timeText = `${seconds}.${tenths}`;
  }

  if (daysText !== lastDaysText) {
    daysDisplay.textContent = lastDaysText = daysText;
  }
  if (timeText !== lastTimeText) {
    timeDisplay.textContent = lastTimeText = timeText;
  }

  if (shouldContinue) {
    animationFrameId = requestAnimationFrame(updateTime);
  }
}

function triggerUpdate() {
  if (animationFrameId === null) {
    updateTime();
  }
}

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
    if (targetInstant) {
      triggerUpdate();
    }
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
  node: modeSelect.value,
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

if (typeof Intl.supportedValuesOf === 'function') {
  const timeZones = Intl.supportedValuesOf('timeZone');
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

if (!JSON.parse(localStorage.getItem(kShowStatsKey) ?? 'true')) {
  showStatsCheckbox.checked = false;
  status.classList.add('hidden');
}

const params = new URLSearchParams(window.location.search);
const tParam = params.get('t');
if (tParam) {
  const t = parseFloat(tParam);
  if (!isNaN(t)) {
    targetInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(t * 1000));
  }
} else {
  settingsDialog.showModal();
}

function updateTimeInput() {
  if (targetInstant) {
    const zdt = targetInstant.toZonedDateTimeISO(timezoneSelect.value);
    // datetime-local expects YYYY-MM-DDTHH:MM:SS
    const iso = zdt.toPlainDateTime().toString().split('.')[0];
    targetTimeInput.value = iso;
  }
}

updateTimeInput();
triggerUpdate();

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

showStatsCheckbox.addEventListener('change', () => {
  localStorage.setItem(kShowStatsKey, JSON.stringify(showStatsCheckbox.checked));
  if (showStatsCheckbox.checked) {
    status.classList.remove('hidden');
  } else {
    status.classList.add('hidden');
  }
});

timezoneSelect.addEventListener('change', updateTimeInput);

targetTimeInput.addEventListener('change', () => {
  if (targetTimeInput.value) {
    const plainDateTime = Temporal.PlainDateTime.from(targetTimeInput.value);
    const zdt = plainDateTime.toZonedDateTime(timezoneSelect.value);
    targetInstant = zdt.toInstant();
    updateUrl();
    triggerUpdate();
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
  document.getElementById('enable-wake-lock')?.parentElement?.remove();
}

const copyUrlButton = document.getElementById('copy-url') as HTMLButtonElement;
copyUrlButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    const originalText = copyUrlButton.textContent;
    copyUrlButton.textContent = 'Copied!';
    setTimeout(() => {
      copyUrlButton.textContent = originalText;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
});
