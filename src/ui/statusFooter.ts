import type { DocumentStats } from '../model/types';

export class StatusFooter {
  private container: HTMLElement;
  private wordsEl: HTMLElement;
  private charsEl: HTMLElement;
  private readTimeEl: HTMLElement;
  private goalEl: HTMLElement;
  private pagesEl: HTMLElement;
  private latencyEl: HTMLElement;
  private pendingStats: DocumentStats | null = null;
  private rafScheduled = false;
  private wordGoal = 0;

  constructor(container: HTMLElement, onGoalClick?: () => void) {
    this.container = container;
    this.container.innerHTML = `
      <div class="vw-footer-left">
        <span id="vw-stat-words" class="vw-stat">0 words</span>
        <span class="vw-stat-dot" aria-hidden="true">·</span>
        <span id="vw-stat-chars" class="vw-stat">0 characters</span>
        <span class="vw-stat-dot" aria-hidden="true">·</span>
        <span id="vw-stat-read" class="vw-stat">0 min read</span>
        <button type="button" id="vw-stat-goal" class="vw-stat-goal" hidden title="Click to configure daily word goal"></button>
      </div>
      <div class="vw-footer-right">
        <span id="vw-stat-pages" class="vw-stat">1 page</span>
        <span class="vw-stat-dot" aria-hidden="true">·</span>
        <span id="vw-stat-latency" class="vw-stat vw-stat-latency" title="Measured input-to-model latency">Input &lt; 1ms</span>
      </div>
    `;

    this.wordsEl = this.container.querySelector('#vw-stat-words') as HTMLElement;
    this.charsEl = this.container.querySelector('#vw-stat-chars') as HTMLElement;
    this.readTimeEl = this.container.querySelector('#vw-stat-read') as HTMLElement;
    this.goalEl = this.container.querySelector('#vw-stat-goal') as HTMLElement;
    this.pagesEl = this.container.querySelector('#vw-stat-pages') as HTMLElement;
    this.latencyEl = this.container.querySelector('#vw-stat-latency') as HTMLElement;

    if (onGoalClick) {
      this.goalEl.addEventListener('click', onGoalClick);
    }
  }

  setWordGoal(goal: number): void {
    this.wordGoal = Math.max(0, goal);
    if (this.pendingStats) {
      this.renderGoal(this.pendingStats.words);
    } else {
      this.renderGoal(0);
    }
  }

  private renderGoal(words: number): void {
    if (this.wordGoal <= 0) {
      this.goalEl.hidden = true;
      return;
    }
    this.goalEl.hidden = false;
    const pct = Math.min(100, Math.round((words / this.wordGoal) * 100));
    this.goalEl.textContent = `Goal ${words.toLocaleString()} / ${this.wordGoal.toLocaleString()} (${pct}%)`;
    this.goalEl.classList.toggle('is-complete', words >= this.wordGoal);
  }

  updateStats(stats: DocumentStats): void {
    this.pendingStats = stats;
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      if (!this.pendingStats) return;
      const s = this.pendingStats;
      this.wordsEl.textContent = `${s.words.toLocaleString()} ${s.words === 1 ? 'word' : 'words'}`;
      this.charsEl.textContent = `${s.characters.toLocaleString()} ${s.characters === 1 ? 'character' : 'characters'}`;
      this.readTimeEl.textContent =
        s.readingTimeMinutes === 0 ? '< 1 min read' : `${s.readingTimeMinutes} min read`;
      this.pagesEl.textContent = `${s.pages.toLocaleString()} ${s.pages === 1 ? 'page' : 'pages'}`;
      this.renderGoal(s.words);
    });
  }

  updateLatency(ms: number): void {
    const label = ms < 1 ? 'Input < 1ms' : `Input ${ms.toFixed(1)}ms`;
    this.latencyEl.textContent = label;
    this.latencyEl.classList.toggle('is-fast', ms < 16);
  }
}
