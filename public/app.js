'use strict';

const SUBJECT_NAMES = {
    math: '数学',
    chemistry: '化学',
    physics: '物理',
    english: '英語',
    social: '社会',
    other: 'その他'
};
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const state = {
    user: null,
    data: null,
    selectedGuildId: null,
    activePage: 'dashboard',
    statPeriod: 'today',
    userDataRef: null,
    timelinePointer: null,
    suppressBlockClick: false,
    edit: null
};

const element = (id) => document.getElementById(id);
const auth = () => firebase.auth();
const database = () => firebase.database();

function setScreen(name) {
    for (const id of ['loading-screen', 'login-screen', 'link-screen']) {
        element(id).classList.toggle('hidden', id !== `${name}-screen`);
    }
    element('app-shell').classList.toggle('hidden', name !== 'app');
}

function showNotice(message, isError = false) {
    const notice = element('notice');
    notice.textContent = message;
    notice.classList.toggle('error', isError);
    notice.classList.remove('hidden');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => notice.classList.add('hidden'), 5000);
}

function setBusy(busy) {
    element('sync-dot').classList.toggle('busy', busy);
}

function formatDuration(value) {
    const minutes = Math.floor(Math.max(0, Number(value) || 0) / MINUTE_MS);
    return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function formatJstDateTime(ms) {
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(ms));
}

function jstInputValue(ms) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(ms));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function parseJstInput(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
    if (!match) {
        return null;
    }
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const utcMs = Date.UTC(year, month - 1, day, hour - 9, minute);
    const check = new Date(utcMs + 9 * 60 * 60 * 1000);
    return check.getUTCFullYear() === year &&
        check.getUTCMonth() === month - 1 &&
        check.getUTCDate() === day &&
        check.getUTCHours() === hour &&
        check.getUTCMinutes() === minute
        ? utcMs
        : null;
}

function currentGuildData() {
    return state.selectedGuildId
        ? state.data?.guilds?.[state.selectedGuildId] || null
        : null;
}

function currentDateKey() {
    return element('timeline-date').value ||
        currentGuildData()?.day?.dateKey || '';
}

function setActionAvailability() {
    const enabled = Boolean(currentGuildData());
    for (const selector of [
        '#pause-button', '#stop-button', '#start-form button',
        '#previous-day', '#next-day', '#timeline-date'
    ]) {
        const target = document.querySelector(selector);
        if (target) target.disabled = !enabled;
    }
}

function renderGuildPicker() {
    const select = element('guild-select');
    const guilds = state.data?.account?.guilds || [];
    const saved = state.user
        ? localStorage.getItem(`study-console:selected-guild:${state.user.uid}`)
        : null;
    if (!guilds.some((guild) => guild.id === state.selectedGuildId)) {
        state.selectedGuildId = guilds.some((guild) => guild.id === saved)
            ? saved
            : guilds[0]?.id || null;
    }
    select.replaceChildren();
    if (guilds.length === 0) {
        select.add(new Option('利用できるサーバーがありません', ''));
    } else {
        for (const guild of guilds) {
            select.add(new Option(guild.name, guild.id));
        }
    }
    select.value = state.selectedGuildId || '';
    select.disabled = guilds.length === 0;
    setActionAvailability();
}

function renderCurrent() {
    const data = currentGuildData();
    const current = data?.current;
    const running = current?.status === 'running';
    const paused = current?.status === 'paused';
    element('current-status').textContent = running
        ? '作業中'
        : paused ? '一時停止中' : '待機中';
    element('current-subject').textContent = running || paused
        ? SUBJECT_NAMES[current.categoryKey] || 'その他'
        : '作業を開始できます';
    element('current-task').textContent = current?.taskName || '';
    element('current-timer').textContent = running
        ? formatDuration(Date.now() - current.startAt)
        : paused ? `一時停止: ${formatJstDateTime(current.pausedAt)}` : '0時間0分';
    element('pause-button').disabled = !running;
    element('stop-button').disabled = !running && !paused;
}

function renderSummaries() {
    const summaries = currentGuildData()?.summaries || {};
    element('summary-today').textContent = formatDuration(summaries.today?.total);
    element('summary-week').textContent = formatDuration(summaries.week?.total);
    element('summary-month').textContent = formatDuration(summaries.month?.total);
}

function addStatRows(container, values) {
    container.replaceChildren();
    const entries = Object.entries(values || {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = '記録はありません。';
        container.append(empty);
        return;
    }
    const maximum = entries[0][1] || 1;
    for (const [label, value] of entries) {
        const row = document.createElement('div');
        const header = document.createElement('div');
        header.className = 'stat-label';
        const name = document.createElement('span');
        const duration = document.createElement('strong');
        name.textContent = label;
        duration.textContent = formatDuration(value);
        header.append(name, duration);
        const bar = document.createElement('div');
        bar.className = 'stat-bar';
        const fill = document.createElement('span');
        fill.style.width = `${Math.max(2, (value / maximum) * 100)}%`;
        bar.append(fill);
        row.append(header, bar);
        container.append(row);
    }
}

function renderStatistics() {
    const summaries = currentGuildData()?.summaries || {};
    const summary = summaries[state.statPeriod] || { total: 0, subjects: {}, tasks: {} };
    const labels = { today: '今日', week: '今週', month: '今月' };
    element('stat-period-label').textContent = `${labels[state.statPeriod]}の合計`;
    element('stat-total').textContent = formatDuration(summary.total);
    addStatRows(element('subject-stats'), summary.subjects);
    addStatRows(element('task-stats'), summary.tasks);
    document.querySelectorAll('.stat-tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.period === state.statPeriod);
    });
}

function dayRange() {
    const day = currentGuildData()?.day;
    return day ? { startAt: day.startAt, endAt: day.endAt } : null;
}

function setBlockPreview(block, startAt, endAt) {
    const range = dayRange();
    if (!range) return;
    block.style.left = `${((startAt - range.startAt) / (range.endAt - range.startAt)) * 100}%`;
    block.style.width = `${Math.max(.5, ((endAt - startAt) / (range.endAt - range.startAt)) * 100)}%`;
}

function timelineMs(event) {
    const track = element('timeline-track');
    const range = dayRange();
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const raw = range.startAt + ratio * (range.endAt - range.startAt);
    return Math.round(raw / (5 * MINUTE_MS)) * 5 * MINUTE_MS;
}

function renderTimeline() {
    const labels = element('timeline-labels');
    const track = element('timeline-track');
    labels.replaceChildren();
    track.replaceChildren();
    const day = currentGuildData()?.day;
    if (!day) return;
    element('timeline-date').value = day.dateKey;
    for (let hour = 0; hour <= 24; hour += 2) {
        const label = document.createElement('span');
        label.style.left = `${(hour / 24) * 100}%`;
        label.textContent = `${String((hour + 2) % 24).padStart(2, '0')}:00`;
        labels.append(label);
        const line = document.createElement('span');
        line.className = `grid-line${hour % 6 === 0 ? ' major' : ''}`;
        line.style.left = `${(hour / 24) * 100}%`;
        track.append(line);
    }
    for (const interval of day.intervals || []) {
        const block = document.createElement('button');
        block.type = 'button';
        block.className = `timeline-block subject-${interval.categoryKey}`;
        const locked = interval.isRunning || interval.isClipped;
        if (locked) block.classList.add('locked');
        if (interval.isClipped) block.classList.add('clipped');
        block.dataset.intervalId = interval.id;
        block.dataset.startAt = interval.originalStartAt;
        block.dataset.endAt = interval.originalEndAt;
        setBlockPreview(block, interval.startAt, interval.endAt);
        const text = document.createElement('span');
        text.className = 'timeline-block-text';
        text.textContent = `${SUBJECT_NAMES[interval.categoryKey] || 'その他'} ${interval.taskName || ''}`.trim();
        block.append(text);
        if (!locked) {
            for (const side of ['left', 'right']) {
                const handle = document.createElement('span');
                handle.className = `resize-handle ${side}`;
                block.append(handle);
            }
        }
        block.addEventListener('pointerdown', (event) => beginBlockPointer(event, interval, block));
        block.addEventListener('click', () => {
            if (!state.suppressBlockClick && !locked) openEditor({ mode: 'update', interval });
            if (locked) showNotice('実行中または日付をまたぐ記録は、タイムラインから直接編集できません。', true);
        });
        track.append(block);
    }
}

function beginBlockPointer(event, interval, block) {
    if (interval.isRunning || interval.isClipped || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const side = event.target.classList.contains('resize-handle')
        ? event.target.classList.contains('left') ? 'left' : 'right'
        : null;
    state.timelinePointer = {
        kind: side ? 'resize' : 'move', side, interval, block,
        pointerId: event.pointerId, startClientMs: timelineMs(event),
        originalStartAt: interval.originalStartAt, originalEndAt: interval.originalEndAt,
        didDrag: false
    };
    block.setPointerCapture(event.pointerId);
}

function beginCreatePointer(event) {
    if (event.target !== element('timeline-track') || event.button !== 0 || !currentGuildData()) return;
    const startAt = timelineMs(event);
    const selection = document.createElement('div');
    selection.className = 'timeline-selection';
    element('timeline-track').append(selection);
    state.timelinePointer = {
        kind: 'create', pointerId: event.pointerId, startAt, endAt: startAt, selection
    };
    element('timeline-track').setPointerCapture(event.pointerId);
}

function moveTimelinePointer(event) {
    const pointer = state.timelinePointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const range = dayRange();
    if (!range) return;
    const pointerMs = timelineMs(event);
    if (pointer.kind === 'create') {
        pointer.endAt = pointerMs;
        const startAt = Math.min(pointer.startAt, pointer.endAt);
        const endAt = Math.max(pointer.startAt, pointer.endAt);
        setBlockPreview(pointer.selection, startAt, Math.max(startAt + MINUTE_MS, endAt));
        pointer.selection.textContent = endAt - startAt >= MINUTE_MS ? formatDuration(endAt - startAt) : '';
        return;
    }
    const delta = pointerMs - pointer.startClientMs;
    let startAt = pointer.originalStartAt;
    let endAt = pointer.originalEndAt;
    if (pointer.kind === 'move') {
        startAt += delta;
        endAt += delta;
        if (startAt < range.startAt) { endAt += range.startAt - startAt; startAt = range.startAt; }
        if (endAt > range.endAt) { startAt -= endAt - range.endAt; endAt = range.endAt; }
    } else if (pointer.side === 'left') {
        startAt = Math.min(pointerMs, endAt - MINUTE_MS);
    } else {
        endAt = Math.max(pointerMs, startAt + MINUTE_MS);
    }
    pointer.nextStartAt = startAt;
    pointer.nextEndAt = endAt;
    pointer.didDrag = Math.abs(delta) >= MINUTE_MS;
    setBlockPreview(pointer.block, startAt, endAt);
    pointer.block.classList.add('dragging');
}

async function endTimelinePointer(event) {
    const pointer = state.timelinePointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    state.timelinePointer = null;
    if (pointer.kind === 'create') {
        pointer.selection.remove();
        const startAt = Math.min(pointer.startAt, pointer.endAt);
        const endAt = Math.max(pointer.startAt, pointer.endAt);
        if (endAt - startAt >= MINUTE_MS) openEditor({ mode: 'create', startAt, endAt });
        return;
    }
    pointer.block.classList.remove('dragging');
    if (!pointer.didDrag || pointer.nextStartAt === pointer.originalStartAt && pointer.nextEndAt === pointer.originalEndAt) {
        renderTimeline();
        return;
    }
    state.suppressBlockClick = true;
    setTimeout(() => { state.suppressBlockClick = false; }, 0);
    try {
        await sendActivityCommand('update_interval', {
            intervalId: pointer.interval.id,
            startAt: new Date(pointer.nextStartAt).toISOString(),
            endAt: new Date(pointer.nextEndAt).toISOString(),
            categoryKey: pointer.interval.categoryKey,
            taskName: pointer.interval.taskName || null
        });
    } catch (error) {
        renderTimeline();
    }
}

function openEditor(edit) {
    state.edit = edit;
    const interval = edit.interval || {};
    const startAt = edit.startAt ?? interval.originalStartAt;
    const endAt = edit.endAt ?? interval.originalEndAt;
    element('edit-title').textContent = edit.mode === 'create' ? '学習記録を追加' : '学習記録を編集';
    element('edit-start').value = jstInputValue(startAt);
    element('edit-end').value = jstInputValue(endAt);
    element('edit-subject').value = interval.categoryKey || 'other';
    element('edit-task').value = interval.taskName || '';
    element('delete-record').classList.toggle('hidden', edit.mode === 'create');
    element('edit-error').textContent = '';
    element('edit-modal').showModal();
}

function closeEditor() {
    element('edit-modal').close();
    state.edit = null;
}

function renderSettings() {
    element('linked-account').textContent = state.data?.account?.discordDisplayName || '連携済み';
    element('google-account').textContent = state.user?.email || state.data?.account?.googleDisplayName || '';
}

function renderApp() {
    if (!state.data?.account?.linked) return;
    setScreen('app');
    element('account-name').textContent = state.data.account.discordDisplayName || '連携済み';
    renderGuildPicker();
    renderCurrent();
    renderSummaries();
    renderTimeline();
    renderStatistics();
    renderSettings();
}

function showPage(page) {
    state.activePage = page;
    document.querySelectorAll('.page').forEach((section) => {
        section.classList.toggle('active', section.id === `page-${page}`);
    });
    document.querySelectorAll('.nav-button').forEach((button) => {
        button.classList.toggle('active', button.dataset.page === page);
    });
}

async function sha256(value) {
    const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function waitForCommand(ref) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            ref.off('value', listener);
            reject(new Error('Botからの応答が時間切れになりました。'));
        }, 130000);
        const listener = (snapshot) => {
            const command = snapshot.val();
            if (command?.status === 'done') {
                clearTimeout(timeout);
                ref.off('value', listener);
                resolve(command.result || { ok: true });
            } else if (command?.status === 'error') {
                clearTimeout(timeout);
                ref.off('value', listener);
                reject(new Error(command.error?.message || '操作に失敗しました。'));
            }
        };
        ref.on('value', listener);
    });
}

async function sendCommand(type, payload = {}, guildId = state.selectedGuildId) {
    if (!state.user) throw new Error('ログインが必要です。');
    if (!['link', 'refresh', 'unlink'].includes(type) && !guildId) {
        throw new Error('操作するサーバーを選択してください。');
    }
    setBusy(true);
    try {
        const ref = database().ref(`commandQueue/${state.user.uid}`).push();
        const command = { type, payload, createdAt: Date.now(), status: 'pending' };
        if (guildId) command.guildId = guildId;
        await ref.set(command);
        return await waitForCommand(ref);
    } finally {
        setBusy(false);
    }
}

async function sendActivityCommand(type, payload) {
    try {
        const result = await sendCommand(type, { ...payload, dateKey: currentDateKey() });
        showNotice('操作を反映しました。');
        return result;
    } catch (error) {
        showNotice(error.message, true);
        throw error;
    }
}

async function loadDay(dateKey) {
    if (!currentGuildData()) return;
    try {
        await sendCommand('load_day', { dateKey });
    } catch (error) {
        showNotice(error.message, true);
        renderTimeline();
    }
}

function changeLogicalDay(offset) {
    const value = currentDateKey();
    if (!value) return;
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    loadDay(date.toISOString().slice(0, 10));
}

function subscribeUserData(user) {
    state.userDataRef?.off();
    state.userDataRef = database().ref(`userData/${user.uid}`);
    state.userDataRef.on('value', (snapshot) => {
        state.data = snapshot.val();
        if (!state.data?.account?.linked) {
            setScreen('link');
            return;
        }
        renderApp();
    }, (error) => showNotice(`同期を開始できません: ${error.message}`, true));
}

function attachEvents() {
    element('google-login').addEventListener('click', async () => {
        element('login-error').textContent = '';
        try {
            await auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
        } catch (error) {
            element('login-error').textContent = `ログインに失敗しました: ${error.message}`;
        }
    });
    element('link-signout').addEventListener('click', () => auth().signOut());
    element('link-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        element('link-error').textContent = '';
        try {
            await sendCommand('link', { codeHash: await sha256(element('link-code').value) }, null);
        } catch (error) {
            element('link-error').textContent = error.message;
        }
    });
    element('guild-select').addEventListener('change', (event) => {
        state.selectedGuildId = event.target.value || null;
        if (state.user && state.selectedGuildId) {
            localStorage.setItem(`study-console:selected-guild:${state.user.uid}`, state.selectedGuildId);
        }
        renderApp();
    });
    element('start-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        await sendActivityCommand('start', {
            categoryKey: element('start-subject').value || null,
            taskName: element('start-task').value.trim() || null
        }).then(() => { element('start-task').value = ''; }).catch(() => null);
    });
    element('pause-button').addEventListener('click', () => sendActivityCommand('pause', {}).catch(() => null));
    element('stop-button').addEventListener('click', () => sendActivityCommand('stop', {}).catch(() => null));
    element('previous-day').addEventListener('click', () => changeLogicalDay(-1));
    element('next-day').addEventListener('click', () => changeLogicalDay(1));
    element('timeline-date').addEventListener('change', (event) => loadDay(event.target.value));
    document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
    document.querySelectorAll('.stat-tab').forEach((button) => button.addEventListener('click', () => {
        state.statPeriod = button.dataset.period;
        renderStatistics();
    }));
    element('timeline-track').addEventListener('pointerdown', beginCreatePointer);
    element('timeline-track').addEventListener('pointermove', moveTimelinePointer);
    element('timeline-track').addEventListener('pointerup', endTimelinePointer);
    element('timeline-track').addEventListener('pointercancel', endTimelinePointer);
    element('edit-close').addEventListener('click', closeEditor);
    element('edit-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const startAt = parseJstInput(element('edit-start').value);
        const endAt = parseJstInput(element('edit-end').value);
        const error = element('edit-error');
        if (!startAt || !endAt || endAt - startAt < MINUTE_MS) {
            error.textContent = '開始と終了を1分以上空けて正しく入力してください。';
            return;
        }
        if (endAt > Date.now()) {
            error.textContent = '未来の記録は作成できません。';
            return;
        }
        const payload = {
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString(),
            categoryKey: element('edit-subject').value,
            taskName: element('edit-task').value.trim() || null
        };
        try {
            if (state.edit.mode === 'create') await sendActivityCommand('create_range', payload);
            else await sendActivityCommand('update_interval', { intervalId: state.edit.interval.id, ...payload });
            closeEditor();
        } catch (commandError) {
            error.textContent = commandError.message;
        }
    });
    element('delete-record').addEventListener('click', async () => {
        if (!state.edit?.interval || !window.confirm('この学習記録を削除しますか？')) return;
        try {
            await sendActivityCommand('delete_interval', { intervalId: state.edit.interval.id });
            closeEditor();
        } catch (error) {
            element('edit-error').textContent = error.message;
        }
    });
    element('unlink-button').addEventListener('click', async () => {
        if (!window.confirm('Discord連携を解除しますか？ Webからの記録操作はできなくなります。')) return;
        try { await sendCommand('unlink', {}, null); } catch (error) { showNotice(error.message, true); }
    });
    element('signout-button').addEventListener('click', () => auth().signOut());
}

async function waitForFirebase() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (window.firebase?.apps?.length && window.firebase.auth && window.firebase.database) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Firebaseの初期化に失敗しました。Hosting設定を確認してください。');
}

async function initialize() {
    attachEvents();
    try {
        await waitForFirebase();
        auth().onAuthStateChanged((user) => {
            state.user = user;
            state.data = null;
            state.selectedGuildId = null;
            if (!user) {
                state.userDataRef?.off();
                state.userDataRef = null;
                setScreen('login');
                return;
            }
            setScreen('loading');
            subscribeUserData(user);
        });
        setInterval(() => { if (state.data?.account?.linked) renderCurrent(); }, 30000);
    } catch (error) {
        setScreen('login');
        element('login-error').textContent = error.message;
    }
}

window.addEventListener('DOMContentLoaded', initialize);
