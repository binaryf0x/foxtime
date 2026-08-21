import { Temporal } from 'temporal-polyfill';
import { getCurrentServerTime, initWorker } from './worker-client';
import { initCommonUI } from './ui';

let targetInstant: Temporal.Instant | null = null;
let lastTimeText = '';
let lastDaysText = '';
let animationFrameId: number | null = null;

const timeDisplay = document.getElementById('time') as HTMLElement;
const daysDisplay = document.getElementById('days') as HTMLElement;
const timezoneSelect = document.getElementById('timezone') as HTMLSelectElement;
const targetTimeInput = document.getElementById('target-time') as HTMLInputElement;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;

initWorker(() => {
  if (targetInstant) {
    triggerUpdate();
  }
});
initCommonUI();

const params = new URLSearchParams(window.location.search);

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

  if (!targetInstant) {
    daysDisplay.textContent = lastDaysText = "";
    timeDisplay.textContent = lastTimeText = "??:??:??.?";
    document.title = "🦊⌛";
    return;
  }

  const currentServerTime = getCurrentServerTime();
  const nowInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(currentServerTime));
  let shouldContinue = false;

  let diff = targetInstant.epochMilliseconds - nowInstant.epochMilliseconds;
  if (diff <= 0) {
    diff = 0;
    document.title = "🦊⌛";
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

const tParam = params.get('t');
if (tParam) {
  const t = parseFloat(tParam);
  if (!isNaN(t)) {
    targetInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(t * 1000));
    document.title = "🦊⏳";
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

timezoneSelect.addEventListener('change', updateTimeInput);

targetTimeInput.addEventListener('change', () => {
  if (targetTimeInput.value) {
    const plainDateTime = Temporal.PlainDateTime.from(targetTimeInput.value);
    const zdt = plainDateTime.toZonedDateTime(timezoneSelect.value);
    targetInstant = zdt.toInstant();
    document.title = "🦊⏳";
    updateUrl();
    triggerUpdate();
  }
});

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
