import { Temporal } from 'temporal-polyfill';
import { getCurrentServerTime, initWorker } from './worker-client';
import { initCommonUI } from './ui';

type SVGElementInHTML = HTMLElement & SVGSVGElement;
type GElementInHTML = HTMLElement & SVGGElement;

const kShowAnalogKey = 'show-analog';
const kShowDigitalKey = 'show-digital';

initWorker();
initCommonUI();

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
const showAnalogCheckbox = document.getElementById('show-analog') as HTMLInputElement;
const showDigitalCheckbox = document.getElementById('show-digital') as HTMLInputElement;
const timezoneSelect = document.getElementById('timezone') as HTMLSelectElement;

if (!JSON.parse(localStorage.getItem(kShowAnalogKey) ?? 'true')) {
  showAnalogCheckbox.checked = false;
  clock.classList.add('hidden');
}
if (!JSON.parse(localStorage.getItem(kShowDigitalKey) ?? 'true')) {
  showDigitalCheckbox.checked = false;
  time.classList.add('hidden');
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
  const currentServerTime = getCurrentServerTime();

  const nowInstant = Temporal.Instant.fromEpochMilliseconds(Math.round(currentServerTime));
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
