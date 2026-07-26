import { Temporal } from 'temporal-polyfill';

const kShowStatsKey = 'show-stats';

function populateTimezoneSelect() {
  const timezoneSelect = document.getElementById('timezone') as HTMLSelectElement;
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
}

function initStats() {
  const statusElements = document.querySelectorAll('.status');
  const showStatsCheckbox = document.getElementById('show-stats') as HTMLInputElement;

  if (!JSON.parse(localStorage.getItem(kShowStatsKey) ?? 'true')) {
    showStatsCheckbox.checked = false;
    statusElements.forEach((el) => el.classList.add('hidden'));
  }

  showStatsCheckbox.addEventListener('change', () => {
    localStorage.setItem(kShowStatsKey, JSON.stringify(showStatsCheckbox.checked));
    statusElements.forEach((el) => {
      if (showStatsCheckbox.checked) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  });
}

function initFullscreen() {
  const fullscreenCheckbox = document.getElementById('fullscreen') as HTMLInputElement;

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
}

function initWakeLock() {
  const toggle = document.getElementById('enable-wake-lock') as HTMLInputElement;

  if (navigator.wakeLock?.request) {
    let wakeLock: WakeLockSentinel | null = null;
    toggle.addEventListener('change', async () => {
      if (toggle.checked && !wakeLock) {
        toggle.disabled = true;
        try {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.onrelease = () => {
            toggle.checked = false;
            wakeLock = null;
          };
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
    toggle.parentElement?.remove();
  }
}

function initSettingsDialog() {
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
}

export function initCommonUI() {
  initStats();
  initFullscreen();
  initWakeLock();
  initSettingsDialog();
  populateTimezoneSelect();
}
