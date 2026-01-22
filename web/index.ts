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

function updateTime() {
  const now = new Date(performance.now() + timeOrigin);
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const tenths = Math.floor(now.getMilliseconds() / 100).toString();
  time.textContent = `${hours}:${minutes}:${seconds}.${tenths}`;

  const emojiIndex = (now.getHours() % 12) * 2 + Math.floor(now.getMinutes() / 30);
  const emoji = clockEmoji[emojiIndex];
  document.title = `🦊${emoji}`;

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

  requestAnimationFrame(updateTime);
}
updateTime();

document.onvisibilitychange = () => {
  worker.postMessage({hidden: document.hidden});
};

if (navigator.wakeLock?.request) {
  (document.getElementById('wake-lock') as HTMLElement).style.display = 'flex';
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
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}

clock.addEventListener('click', toggleFullscreen);
time.addEventListener('click', toggleFullscreen);
