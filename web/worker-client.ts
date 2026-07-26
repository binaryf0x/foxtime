declare global {
  interface Window {
    PAGE_LOAD_TIME: number;
    INITIAL_SERVER_TIME: number;
    WEB_TRANSPORT_PORT: number;
    WEB_TRANSPORT_CERT: string;
  }
}

const kNetworkModeKey = 'network-mode';

let timeOrigin = window.INITIAL_SERVER_TIME - window.PAGE_LOAD_TIME;
let measurementTime: number | null = null;
let freq = 1;
let lastSyncRequest = -Infinity;
let postToWorkerFn: ((msg: object) => void) | null = null;

export function postToWorker(msg: object) {
  if (postToWorkerFn) {
    postToWorkerFn(msg);
  }
}

export function getCurrentServerTime(now: number = performance.now()): number {
  const timeSinceData = measurementTime !== null ? now - measurementTime : now - window.PAGE_LOAD_TIME;
  const syncThreshold = measurementTime !== null ? 70_000 : 5_000;
  if (timeSinceData > syncThreshold && now - lastSyncRequest > 10_000) {
    lastSyncRequest = now;
    postToWorker({ sync: true });
  }

  if (measurementTime !== null) {
    const elapsedLocal = now - measurementTime;
    const elapsedServer = elapsedLocal * freq;
    return timeOrigin + measurementTime + elapsedServer;
  } else {
    return timeOrigin + now;
  }
}

export function initWorker(onTimeOriginUpdate?: () => void) {
  const delayDisplay = document.getElementById('delay') as HTMLElement;
  const offsetDisplay = document.getElementById('offset') as HTMLElement;
  const freqDisplay = document.getElementById('freq') as HTMLElement;
  const modeDisplay = document.getElementById('mode') as HTMLElement;
  const modeSelect = document.getElementById('network-mode') as HTMLSelectElement;

  function handleWorkerMessage(event: MessageEvent) {
    if (event.data.delay !== undefined) {
      delayDisplay.textContent = event.data.delay.toFixed(2);
    }
    if (event.data.offset !== undefined) {
      offsetDisplay.textContent = event.data.offset;
    }
    if (event.data.freq !== undefined) {
      freq = event.data.freq;
      freqDisplay.textContent = ((event.data.freq - 1) * 1_000_000).toFixed(2);
    }
    if (event.data.localTimeOffset !== undefined) {
      measurementTime = event.data.localTimeOffset - performance.timeOrigin;
    }
    if (event.data.mode !== undefined) {
      modeDisplay.textContent = event.data.mode;
    }
    if (event.data.timeOriginOffset !== undefined) {
      timeOrigin = performance.timeOrigin - event.data.timeOriginOffset;
      if (onTimeOriginUpdate) {
        onTimeOriginUpdate();
      }
    }
  }

  let modeValue = localStorage.getItem(kNetworkModeKey) ?? 'Auto';
  modeSelect.value = modeValue;

  if (!window.WEB_TRANSPORT_PORT || typeof WebTransport === 'undefined') {
    const webTransportOption = modeSelect.querySelector('option[value="WebTransport"]') as HTMLOptionElement | null;
    if (webTransportOption) {
      webTransportOption.textContent += ' (Unsupported)';
      webTransportOption.disabled = true;
    }
  }

  window.addEventListener('storage', (event) => {
    if (event.key === kNetworkModeKey && modeSelect) {
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
    mode: modeValue,
  };

  if (typeof SharedWorker !== 'undefined') {
    const sharedWorker = new SharedWorker(new URL('./worker.js', import.meta.url));
    sharedWorker.port.start();
    sharedWorker.port.postMessage(workerConfig);
    sharedWorker.port.onmessage = handleWorkerMessage;
    postToWorkerFn = (msg) => sharedWorker.port.postMessage(msg);
  } else {
    const worker = new Worker(new URL('./worker.js', import.meta.url));
    worker.postMessage(workerConfig);
    worker.onmessage = handleWorkerMessage;
    postToWorkerFn = (msg) => worker.postMessage(msg);
  }
}
