declare global {
  interface Window {
    INITIAL_SERVER_TIME: number;
  }
}

type SVGElementInHTML = HTMLElement & SVGSVGElement;
type GElementInHTML = HTMLElement & SVGGElement;

let timeOrigin = window.INITIAL_SERVER_TIME - performance.now();

const worker = new Worker(new URL('./worker.js', import.meta.url));
worker.postMessage({timeOrigin: performance.timeOrigin});
worker.onmessage = (event: MessageEvent) => {
  (document.getElementById('delay') as HTMLElement).textContent = event.data.delay.toFixed(2);
  (document.getElementById('offset') as HTMLElement).textContent = event.data.offset;
  timeOrigin = performance.timeOrigin - event.data.timeOriginOffset;
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

function updateUrl() {
  const params = new URLSearchParams(window.location.search);
  const settings = [
    { id: 'analog', checkbox: showAnalogCheckbox },
    { id: 'digital', checkbox: showDigitalCheckbox },
    { id: 'stats', checkbox: showStatsCheckbox },
  ];

  for (const { id, checkbox } of settings) {
    if (checkbox.checked) {
      params.delete(id);
    } else {
      params.set(id, '0');
    }
  }

  const newSearch = params.toString();
  const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
  if (window.location.search !== (newSearch ? '?' + newSearch : '')) {
    window.history.replaceState({}, '', newUrl);
  }
}

function syncSettings() {
  if (showAnalogCheckbox.checked) {
    clock.classList.remove('hidden');
  } else {
    clock.classList.add('hidden');
  }
  if (showDigitalCheckbox.checked) {
    time.classList.remove('hidden');
  } else {
    time.classList.add('hidden');
  }
  if (showStatsCheckbox.checked) {
    status.classList.remove('hidden');
  } else {
    status.classList.add('hidden');
  }
  updateUrl();
}

// Initial load
const params = new URLSearchParams(window.location.search);
if (params.get('analog') === '0') {
  showAnalogCheckbox.checked = false;
}
if (params.get('digital') === '0') {
  showDigitalCheckbox.checked = false;
}
if (params.get('stats') === '0') {
  showStatsCheckbox.checked = false;
}
syncSettings();

let lastTime = '??:??:??.?';
let lastTitle = "🦊🕒";

function updateTime() {
  const now = new Date(performance.now() + timeOrigin);

  if (showDigitalCheckbox.checked) {
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const tenths = Math.floor(now.getMilliseconds() / 100).toString();
    const newTime = `${hours}:${minutes}:${seconds}.${tenths}`;
    if (newTime !== lastTime) {
      time.textContent = lastTime = newTime;
    }
  }

  const emojiIndex = (now.getHours() % 12) * 2 + Math.floor(now.getMinutes() / 30);
  const newTitle = `🦊${clockEmoji[emojiIndex]}`;
  if (newTitle !== lastTitle) {
    document.title = lastTitle = newTitle;
  }

  if (showAnalogCheckbox.checked) {
    let total = 1000;
    let accumulator = now.getSeconds() * total + now.getMilliseconds();
    total *= 60;
    secondTransform.setRotate((accumulator * 360) / total, 50, 50);
    accumulator += now.getMinutes() * total;
    total *= 60;
    minuteTransform.setRotate((accumulator * 360) / total, 50, 50);
    accumulator += now.getHours() * total;
    total *= 12;
    hourTransform.setRotate((accumulator * 360) / total, 50, 50);
  }

  requestAnimationFrame(updateTime);
}
updateTime();

document.onvisibilitychange = () => {
  worker.postMessage({hidden: document.hidden});
};

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

showAnalogCheckbox.addEventListener('change', syncSettings);
showDigitalCheckbox.addEventListener('change', syncSettings);
showStatsCheckbox.addEventListener('change', syncSettings);

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
