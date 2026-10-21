export const markup=`<div class="app">

  <nav class="toolbar" aria-label="Demo controls">
    <button id="mixed">Mixed day</button><button id="all-work">All working</button><button id="all-idle">All idle</button><button id="all-wait">All waiting</button>
    <button id="workshop-view" aria-pressed="false">Workshop preview</button><button id="music-view" aria-pressed="false">Music-room preview</button><button id="dorm-view" aria-pressed="false">Sleeping-area preview</button><button id="mail-view" aria-pressed="false">Mail-room preview</button><button id="spots" aria-pressed="false">Show spots</button><span class="spacer"></span><button id="music" aria-pressed="false"><span class="music-icon" aria-hidden="true">♫</span><span id="music-label">Play music</span></button>
    <button id="motion" aria-pressed="false">Pause motion</button><button id="demo" class="primary">Play scripted demo</button>
  </nav>
  <section class="live-panel" aria-label="Live shared habitat">
    <strong>Live shared habitat</strong> <span id="live-status" role="status">Demo mode</span>
    <p id="live-help" class="preference-note">Connect up to ten Claude or Codex sessions. Each keeps its own bunny; music remains simulated.</p>
    <div>
      <label>Mode<select id="live-mode"><option value="live">Live habitat</option><option value="demo">Demo</option></select></label><label><input id="live-auto" type="checkbox" checked> Automatically fill free spots</label>
      <label>Session<select id="live-session" disabled><option value="">Choose a session</option></select></label>
      <label>Bunny<select id="live-bunny"></select></label><button id="live-bind" type="button" disabled>Bind session</button><button id="live-unbind" type="button" disabled>Unbind bunny</button>
    </div><p id="live-capacity" class="preference-note" role="status"></p><p id="live-detail" class="preference-note"></p>
  </section>
  <div class="layout">
    <section class="scene-panel" aria-label="Shared burrow habitat">
      <div class="scene-top"><strong id="summary">10 bunnies at home</strong><span id="music-status">The record is resting</span></div>
      <div class="stage"><canvas id="habitat" width="1600" height="1400" aria-label="Four-room bunny habitat, with ten unique places in each room. Select a bunny from the agent list to inspect or change its simulated state."></canvas><div id="loading" class="loading">Lighting the candles…</div></div>
      <div class="room-list" id="room-counts" aria-label="Bunnies in each room"></div>
      <p class="scene-hint">Select a bunny to change its apron color. Room previews bring all ten bunnies together for a closer look.</p>
      <p class="demo-step" id="demo-step" role="status" aria-live="polite"></p>
    </section>
    <aside class="sidebar" aria-label="Simulated agents">
      <section class="placement-panel" aria-label="Bunny position controls">
        <details id="placement" open>
          <summary id="placement-title">Adjust workshop position</summary>
          <p id="placement-room" class="placement-room">Workshop</p>
          <label for="placement-bunny">Bunny to adjust</label><select id="placement-bunny"></select>
          <p class="preference-note" id="placement-note">Arrow buttons move this bunny immediately.</p>
          <div class="placement-controls" role="group" aria-label="Adjust selected bunny position">
            <button type="button" data-nudge="0,-3" aria-label="Move spot up">↑</button><button type="button" data-nudge="-3,0" aria-label="Move spot left">←</button><button type="button" data-nudge="3,0" aria-label="Move spot right">→</button><button type="button" data-nudge="0,3" aria-label="Move spot down">↓</button><button id="spot-turn" type="button">Turn</button><button id="spot-reset" type="button">Reset spot</button><button id="spot-undo" type="button" disabled>Undo move</button>
          </div>
          <output id="spot-position" aria-live="polite"></output><button id="placement-preview" type="button" hidden>Open workshop preview</button>
        </details>
        <details class="music-recovery"><summary>Music-room recovery</summary><p class="preference-note" id="music-recovery-note">Restore the polished music-room layout if its spots were moved by mistake.</p><div class="placement-controls"><button id="music-restore" type="button">Restore music layout</button><button id="music-restore-undo" type="button" disabled>Undo music restore</button></div></details>
      </section>

      <div class="sidebar-heading"><h2>The residents</h2><span>10 demo agents</span></div><div class="agents" id="agents"></div>
      <section class="inspector" aria-label="Selected bunny"><h3 id="selected-name">Clover</h3><p id="conversation-hint" class="preference-note" role="status" aria-live="polite">Demo bunny · no conversation linked.</p><label for="agent-state">Simulated agent state</label><select id="agent-state"><option value="working">Working</option><option value="idle">Idle</option><option value="approval">Waiting for approval</option><option value="input">Waiting for input</option><option value="question">Question · continuing work</option><option value="finished">Finished · unread</option><option value="interrupted">Interrupted</option><option value="unknown">Activity unknown</option></select><p class="destination" id="destination"></p>
        <div class="apron-settings"><label for="apron-color" id="apron-label">Apron color</label><div class="color-control"><input id="apron-color" type="color" value="#78964b"><output id="apron-value" for="apron-color">#78964b</output><button id="apron-reset" type="button">Reset</button></div><div id="apron-presets" class="apron-presets" role="group" aria-label="Apron color presets"></div><p class="preference-note" id="preference-note">Colors are saved in this browser.</p></div>

      </section>
    </aside>
  </div>
  <footer><span>Four rooms · 10 places in every room</span><span id="motion-note">Candles on. Make yourself at home.</span></footer>
</div>
<div class="demo-cursor" id="demo-cursor" aria-hidden="true"><svg viewBox="0 0 30 36"><path d="M3 2L25 22L15 23L10 33L3 2Z" fill="#fff3d9" stroke="#382815" stroke-width="2"/></svg></div>
`;
