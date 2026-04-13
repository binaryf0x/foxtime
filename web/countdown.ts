import { Temporal } from 'temporal-polyfill';

declare global {
  interface Window {
    INITIAL_SERVER_TIME: number;
    WEB_TRANSPORT_PORT: number;
    WEB_TRANSPORT_CERT: string;
  }
}

let timeOrigin = window.INITIAL_SERVER_TIME - performance.now();
let targetInstant: Temporal.Instant | null = null;
let lastDaysText = '';
let lastPrefix = '';
let lastSecondsTensVisible = true;
let lastSecondsTens = -1;
let lastSecondsOnes = -1;
let lastTenths = -1;
let animationFrameId: number | null = null;

const delayDisplay = document.getElementById('delay') as HTMLElement;
const offsetDisplay = document.getElementById('offset') as HTMLElement;
const modeDisplay = document.getElementById('mode') as HTMLElement;
const countdownPrefix = document.getElementById('countdown-prefix') as HTMLElement;
const secondsTensWheel = document.getElementById('seconds-tens-wheel') as HTMLElement;
const secondsTensInner = document.getElementById('seconds-tens-inner') as HTMLElement;
const secondsOnesInner = document.getElementById('seconds-ones-inner') as HTMLElement;
const secondsTenthsInner = document.getElementById('seconds-tenths-inner') as HTMLElement;
const daysDisplay = document.getElementById('days') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const showStatsCheckbox = document.getElementById('show-stats') as HTMLInputElement;
const fullscreenCheckbox = document.getElementById('fullscreen') as HTMLInputElement;
const timezoneSelect = document.getElementById('timezone') as HTMLSelectElement;
const targetTimeInput = document.getElementById('target-time') as HTMLInputElement;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const pageContent = document.getElementById('content') as HTMLElement;

function updateUrl() {
  const params = new URLSearchParams(window.location.search);

  if (showStatsCheckbox.checked) {
    params.delete('stats');
  } else {
    params.set('stats', '0');
  }

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

function syncSettings() {
  if (showStatsCheckbox.checked) {
    status.classList.remove('hidden');
  } else {
    status.classList.add('hidden');
  }

  if (targetInstant) {
    const zdt = targetInstant.toZonedDateTimeISO(timezoneSelect.value);
    // datetime-local expects YYYY-MM-DDTHH:MM:SS
    const iso = zdt.toPlainDateTime().toString().split('.')[0];
    targetTimeInput.value = iso;
  }

  updateUrl();
}

function updateTime() {
  animationFrameId = null;

  if (!targetInstant) {
    daysDisplay.textContent = lastDaysText = "";
    return;
  }

  const nowInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(performance.now() + timeOrigin));
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
  let prefix = '';
  let showTens = true;

  if (days > 0) {
    daysText = `${days} ${days === 1 ? 'day' : 'days'}`;
    prefix = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:`;
  } else if (hours > 0) {
    prefix = `${hours}:${minutes.toString().padStart(2, '0')}:`;
  } else if (minutes > 0) {
    prefix = `${minutes}:`;
  } else {
    showTens = seconds >= 10;
  }

  if (daysText !== lastDaysText) {
    daysDisplay.textContent = lastDaysText = daysText;
  }
  if (prefix !== lastPrefix) {
    countdownPrefix.textContent = lastPrefix = prefix;
  }
  if (showTens !== lastSecondsTensVisible) {
    secondsTensWheel.style.display = showTens ? '' : 'none';
    lastSecondsTensVisible = showTens;
  }

  const secondsTensVal = Math.floor(seconds / 10);
  if (secondsTensVal !== lastSecondsTens) {
    secondsTensInner.style.transform = `translateY(-${secondsTensVal}em)`;
    lastSecondsTens = secondsTensVal;
  }

  const secondsOnesVal = seconds % 10;
  if (secondsOnesVal !== lastSecondsOnes) {
    secondsOnesInner.style.transform = `translateY(-${secondsOnesVal}em)`;
    lastSecondsOnes = secondsOnesVal;
  }

  if (tenths !== lastTenths) {
    secondsTenthsInner.style.transform = `translateY(-${tenths}em)`;
    lastTenths = tenths;
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

const worker = new Worker(new URL('./worker.js', import.meta.url));
worker.postMessage({
  webTransportPort: window.WEB_TRANSPORT_PORT,
  webTransportCert: window.WEB_TRANSPORT_CERT,
});
worker.onmessage = (event: MessageEvent) => {
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
    if (targetInstant) {
      triggerUpdate();
    }
  }
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

const params = new URLSearchParams(window.location.search);
if (params.get('stats') === '0') {
  showStatsCheckbox.checked = false;
}
const tParam = params.get('t');
if (tParam) {
  const t = parseFloat(tParam);
  if (!isNaN(t)) {
    targetInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(t * 1000));
  }
}

syncSettings();
triggerUpdate();

if (!tParam) {
  settingsDialog.showModal();
}

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

showStatsCheckbox.addEventListener('change', syncSettings);
timezoneSelect.addEventListener('change', syncSettings);

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
