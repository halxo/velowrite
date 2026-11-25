export interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
  version?: string;
  releaseName?: string;
  percent?: number;
  bytesPerSecond?: number;
  message?: string;
}

export interface DesktopAppInfo {
  version: string;
  platform: string;
  isPackaged: boolean;
  repoUrl: string;
}

export interface VeloWriteDesktopBridge {
  getAppInfo: () => Promise<DesktopAppInfo>;
  checkForUpdates: () => Promise<{ ok: boolean; packaged?: boolean; error?: string }>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (cb: (event: UpdateStatusEvent) => void) => () => void;
}

declare global {
  interface Window {
    velowriteDesktop?: VeloWriteDesktopBridge;
  }
}

export class UpdateBanner {
  private el: HTMLDivElement;
  private textEl: HTMLSpanElement;
  private actionBtn: HTMLButtonElement;
  private dismissBtn: HTMLButtonElement;
  private hideTimer: number | null = null;
  private onInstall: () => void;

  constructor(onInstall: () => void) {
    this.onInstall = onInstall;

    this.el = document.createElement('div');
    this.el.id = 'vw-update-banner';
    this.el.className = 'vw-update-banner';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');

    this.el.innerHTML = `
      <span class="vw-update-dot" aria-hidden="true"></span>
      <span class="vw-update-text"></span>
      <button type="button" class="vw-update-action" hidden>Restart &amp; Update</button>
      <button type="button" class="vw-update-dismiss" aria-label="Dismiss">&times;</button>
    `;

    this.textEl = this.el.querySelector('.vw-update-text') as HTMLSpanElement;
    this.actionBtn = this.el.querySelector('.vw-update-action') as HTMLButtonElement;
    this.dismissBtn = this.el.querySelector('.vw-update-dismiss') as HTMLButtonElement;

    this.actionBtn.addEventListener('click', () => this.onInstall());
    this.dismissBtn.addEventListener('click', () => this.hide());

    document.body.appendChild(this.el);
  }

  showStatus(ev: UpdateStatusEvent, manualTrigger = false): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.actionBtn.hidden = true;
    this.el.classList.remove('is-ready', 'is-error');

    switch (ev.status) {
      case 'checking':
        if (!manualTrigger) return;
        this.textEl.textContent = 'Checking GitHub for updates…';
        this.show();
        break;
      case 'available':
        this.textEl.textContent = `Downloading VeloWrite ${ev.releaseName ?? ev.version ?? ''}…`;
        this.show();
        break;
      case 'downloading':
        this.textEl.textContent = `Downloading update… ${ev.percent ?? 0}%`;
        this.show();
        break;
      case 'downloaded':
        this.textEl.textContent = `VeloWrite ${ev.releaseName ?? ev.version ?? ''} is ready`;
        this.actionBtn.hidden = false;
        this.el.classList.add('is-ready');
        this.show();
        break;
      case 'up-to-date':
        if (!manualTrigger) return;
        this.textEl.textContent = `VeloWrite v${ev.version ?? ''} is up to date`;
        this.show();
        this.hideTimer = window.setTimeout(() => this.hide(), 3200);
        break;
      case 'error':
        if (!manualTrigger) return;
        this.textEl.textContent = ev.message || 'Could not check for updates';
        this.el.classList.add('is-error');
        this.show();
        this.hideTimer = window.setTimeout(() => this.hide(), 4500);
        break;
    }
  }

  private show(): void {
    this.el.classList.add('is-visible');
  }

  hide(): void {
    this.el.classList.remove('is-visible');
  }
}
