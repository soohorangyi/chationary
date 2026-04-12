// Vocab Helper Extension for SillyTavern
// 드래그로 단어/문장 선택 → 팝업 번역 + 단어장 저장

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

function getSTContext() {
    return window.SillyTavern?.getContext() || {};
}

const EXT_NAME = 'vocab-helper';

// ── 기본 언어 탭 ───────────────────────────────────────────
const DEFAULT_LANGS = [
    { id: 'en',    label: '🇺🇸 영어' },
    { id: 'ja',    label: '🇯🇵 일본어' },
    { id: 'other', label: '🌐 기타' },
];

// ── 기본 설정 ──────────────────────────────────────────────
const defaultSettings = {
    vocab_list: [],
    enabled: true,
    connection_profile: '',
    languages: DEFAULT_LANGS.map(l => ({ ...l })),
    wrong_list: [],
};

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(defaultSettings);
    }
    const s = extension_settings[EXT_NAME];
    if (s.connection_profile === undefined) s.connection_profile = '';
    if (!s.languages) s.languages = DEFAULT_LANGS.map(l => ({ ...l }));

    // ── 기존 단어 마이그레이션: lang 필드 없으면 자동 감지 ──
    let migrated = false;
    s.vocab_list.forEach(v => {
        if (!v.lang) {
            const detected = _detectLangFromText(v.word, s.languages.map(l => l.id));
            v.lang = detected;
            migrated = true;
        }
    });
    // lang이 현재 존재하지 않는 탭을 가리키면 첫 번째 탭으로 이동
    const langIds = s.languages.map(l => l.id);
    s.vocab_list.forEach(v => {
        if (!langIds.includes(v.lang)) {
            v.lang = langIds[0] || 'other';
            migrated = true;
        }
    });
    if (migrated) saveSettingsDebounced();

    return s;
}

// ── 언어 자동 감지 ─────────────────────────────────────────
function _detectLangFromText(text, availableIds) {
    if (/[\u3040-\u30ff]/.test(text)) {
        return availableIds.includes('ja') ? 'ja' : 'other';
    }
    if (/^[\u4e00-\u9faf\s]+$/.test(text)) {
        return availableIds.includes('zh') ? 'zh' : 'other';
    }
    if (/[\u0400-\u04ff]/.test(text)) {
        return availableIds.includes('ru') ? 'ru' : 'other';
    }
    if (/[\u0600-\u06ff]/.test(text)) {
        return availableIds.includes('ar') ? 'ar' : 'other';
    }
    if (/^[a-zA-ZÀ-ÿ\s\-'.]+$/.test(text)) {
        return availableIds.includes('en') ? 'en' : 'other';
    }
    return 'other';
}

function detectLanguage(text) {
    const settings = getSettings();
    return _detectLangFromText(text, settings.languages.map(l => l.id));
}

// ── 팝업 DOM ───────────────────────────────────────────────
let $popup = null;

function createPopup() {
    $popup = $(`
        <div id="vh-popup" style="display:none;">
            <div class="vh-popup-header">
                <span class="vh-selected-word"></span>
                <span class="vh-pronunciation" style="display:none;"></span>
                <button class="vh-close-btn" title="닫기">✕</button>
            </div>
            <div class="vh-popup-body">
                <div class="vh-loading">번역 중...</div>
                <div class="vh-result" style="display:none;">
                    <div class="vh-translation"></div>
                    <div class="vh-explanation"></div>
                </div>
            </div>
            <div class="vh-popup-footer">
                <div class="vh-lang-select-row" style="display:none;">
                    <label class="vh-lang-select-label">언어:</label>
                    <select class="vh-lang-select text_pole"></select>
                </div>
                <div class="vh-popup-actions">
                    <button class="vh-save-btn" style="display:none;">📖 저장</button>
                    <span class="vh-saved-badge" style="display:none;">✅ 저장됨</span>
                </div>
            </div>
        </div>
    `);
    $popup.find('.vh-close-btn').on('click', hidePopup);
    $popup.find('.vh-save-btn').on('click', saveCurrentWord);
    $('body').append($popup);
}

function updatePopupLangSelect() {
    const settings = getSettings();
    const $sel = $popup.find('.vh-lang-select').empty();
    settings.languages.forEach(l => {
        $sel.append(`<option value="${l.id}">${l.label}</option>`);
    });
}

// ── 단어장 모달 ───────────────────────────────────────────
let $vocabModal = null;
let modalActiveLang = 'all';

function createVocabModal() {
    $vocabModal = $(`
        <div id="vh-modal-overlay" style="display:none;">
            <div id="vh-modal">
                <div class="vh-modal-header">
                    <span>📖 내 단어장</span>
                    <div class="vh-modal-header-right">
                        <span id="vh-modal-count"></span>
                        <button id="vh-modal-quiz-btn" class="vh-modal-quiz-btn" title="단어 시험">📝 시험</button>
                        <button class="vh-modal-close">✕</button>
                    </div>
                </div>
                <div id="vh-modal-tabs" class="vh-tabs"></div>
                <div class="vh-modal-search">
                    <input type="text" id="vh-modal-search-input" class="text_pole" placeholder="단어 검색...">
                </div>
                <div id="vh-modal-vocab-list"></div>
                <div class="vh-modal-footer">
                    <button id="vh-modal-clear-btn" class="menu_button">🗑 현재 탭 삭제</button>
                </div>
            </div>
        </div>
    `);
    $vocabModal.find('.vh-modal-close').on('click', closeVocabModal);
    $vocabModal.find('#vh-modal-quiz-btn').on('click', () => {
        closeVocabModal();
        openQuizModal();
    });
    $vocabModal.on('click', function(e) {
        if ($(e.target).is('#vh-modal-overlay')) closeVocabModal();
    });
    $vocabModal.find('#vh-modal-search-input').on('input', function() {
        renderModalVocabList($(this).val().trim());
    });
    $vocabModal.find('#vh-modal-clear-btn').on('click', function() {
        const label = modalActiveLang === 'all' ? '전체' : '현재 탭의';
        if (!confirm(`${label} 단어를 삭제할까요?`)) return;
        const settings = getSettings();
        if (modalActiveLang === 'all') {
            settings.vocab_list = [];
        } else {
            settings.vocab_list = settings.vocab_list.filter(v => v.lang !== modalActiveLang);
        }
        saveSettingsDebounced();
        renderModalTabs();
        renderModalVocabList();
        renderVocabList();
        toastr.warning('삭제되었습니다.');
    });
    $(document.body).append($vocabModal);
    $vocabModal.css({ position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh' });
}

function openVocabModal() {
    modalActiveLang = 'all';
    renderModalTabs();
    renderModalVocabList();
    $vocabModal.show();
}

function closeVocabModal() {
    $vocabModal.hide();
}

function renderModalTabs() {
    const settings = getSettings();
    const $tabs = $('#vh-modal-tabs').empty();

    const allCount = settings.vocab_list.length;
    const $all = $(`<button class="vh-tab ${modalActiveLang === 'all' ? 'vh-tab-active' : ''}" data-lang="all">전체 <span class="vh-tab-count">${allCount}</span></button>`);
    $all.on('click', () => { modalActiveLang = 'all'; renderModalTabs(); renderModalVocabList(); });
    $tabs.append($all);

    settings.languages.forEach(l => {
        const cnt = settings.vocab_list.filter(v => v.lang === l.id).length;
        const $tab = $(`<button class="vh-tab ${modalActiveLang === l.id ? 'vh-tab-active' : ''}" data-lang="${l.id}">${l.label} <span class="vh-tab-count">${cnt}</span></button>`);
        $tab.on('click', () => { modalActiveLang = l.id; renderModalTabs(); renderModalVocabList(); });
        $tabs.append($tab);
    });

    const $add = $(`<button class="vh-tab vh-tab-add" title="언어 탭 추가">＋</button>`);
    $add.on('click', openAddLangDialog);
    $tabs.append($add);
}

function renderModalVocabList(filter = '') {
    const settings = getSettings();
    let list = modalActiveLang === 'all'
        ? settings.vocab_list
        : settings.vocab_list.filter(v => v.lang === modalActiveLang);

    if (filter) {
        const f = filter.toLowerCase();
        list = list.filter(v =>
            v.word.toLowerCase().includes(f) ||
            (v.explanation || '').toLowerCase().includes(f)
        );
    }

    const total = modalActiveLang === 'all'
        ? settings.vocab_list.length
        : settings.vocab_list.filter(v => v.lang === modalActiveLang).length;
    $('#vh-modal-count').text(`${total}개 저장됨`);

    const $list = $('#vh-modal-vocab-list').empty();
    if (list.length === 0) {
        $list.append('<div class="vh-empty">저장된 단어가 없습니다.</div>');
        return;
    }

    list.forEach((item) => {
        const realIdx = settings.vocab_list.indexOf(item);
        // 전체 탭일 때만 언어 배지
        const langLabel = modalActiveLang === 'all'
            ? (settings.languages.find(l => l.id === item.lang)?.label || item.lang || '')
            : '';
        $list.append(buildVocabItemEl(item, realIdx, langLabel, true));
    });
}

// ── 설정 패널 탭 상태 ──────────────────────────────────────
let panelActiveLang = 'all';

// ── 공통 단어 아이템 엘리먼트 빌더 ───────────────────────
function buildVocabItemEl(item, realIdx, langLabel, isModal) {
    const $item = $(`
        <div class="vh-vocab-item">
            <div class="vh-vocab-item-header">
                <div class="vh-vocab-word-row">
                    <span class="vh-vocab-word">${escapeHtml(item.word)}</span>${item.pronunciation ? `<span class="vh-vocab-pronunciation">${escapeHtml(item.pronunciation)}</span>` : ''}
                </div>
                <div class="vh-vocab-item-actions">
                    ${langLabel ? `<span class="vh-vocab-lang-badge">${escapeHtml(langLabel)}</span>` : ''}
                    <span class="vh-vocab-date">${item.date}</span>
                    <button class="vh-delete-btn" data-index="${realIdx}" title="삭제">🗑</button>
                </div>
            </div>
            <div class="vh-vocab-explanation">${escapeHtml(item.explanation || '').replace(/\n/g, '<br>')}</div>
            ${item.context ? `<div class="vh-vocab-context">"${escapeHtml(item.context)}"</div>` : ''}
        </div>
    `);
    $item.find('.vh-delete-btn').on('click', function(e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('index'));
        const word = getSettings().vocab_list[idx]?.word;
        getSettings().vocab_list.splice(idx, 1);
        saveSettingsDebounced();
        if (isModal) {
            renderModalTabs();
            renderModalVocabList($('#vh-modal-search-input').val()?.trim() || '');
        }
        renderPanelTabs();
        renderVocabList($('#vh-search-input').val()?.trim() || '');
        toastr.info(`"${word}" 삭제됨`);
    });
    return $item;
}

// ── 언어 추가 다이얼로그 ───────────────────────────────────
function openAddLangDialog() {
    const PRESETS = [
        { id: 'zh', label: '🇨🇳 중국어' },
        { id: 'es', label: '🇪🇸 스페인어' },
        { id: 'fr', label: '🇫🇷 프랑스어' },
        { id: 'de', label: '🇩🇪 독일어' },
        { id: 'ru', label: '🇷🇺 러시아어' },
        { id: 'ar', label: '🇸🇦 아랍어' },
        { id: 'pt', label: '🇧🇷 포르투갈어' },
        { id: 'it', label: '🇮🇹 이탈리아어' },
    ];
    const settings = getSettings();
    const existIds = settings.languages.map(l => l.id);
    const available = PRESETS.filter(p => !existIds.includes(p.id));

    const $dlg = $(`
        <div id="vh-add-lang-overlay">
            <div id="vh-add-lang-dialog">
                <div class="vh-add-lang-header">🌐 언어 탭 관리</div>
                <div class="vh-add-lang-body">
                    <div class="vh-add-lang-section">
                        <div class="vh-add-lang-label">빠른 추가</div>
                        <div id="vh-lang-presets" class="vh-lang-presets">
                            ${available.length === 0 ? '<span style="opacity:0.5;font-size:0.82rem;">추가 가능한 프리셋 없음</span>' : ''}
                        </div>
                    </div>
                    <div class="vh-add-lang-section">
                        <div class="vh-add-lang-label">직접 입력</div>
                        <div class="vh-add-lang-custom-row">
                            <input type="text" id="vh-custom-lang-id" class="text_pole" placeholder="ID (예: ko)" maxlength="10">
                            <input type="text" id="vh-custom-lang-label" class="text_pole" placeholder="탭 이름 (예: 🇰🇷 한국어)" maxlength="20">
                            <button id="vh-custom-lang-add" class="menu_button">추가</button>
                        </div>
                    </div>
                    <div class="vh-add-lang-section">
                        <div class="vh-add-lang-label">현재 탭 목록</div>
                        <div id="vh-lang-manage-list"></div>
                    </div>
                </div>
                <div class="vh-add-lang-footer">
                    <button id="vh-add-lang-close" class="menu_button">닫기</button>
                </div>
            </div>
        </div>
    `);

    // 프리셋 버튼
    available.forEach(p => {
        const $btn = $(`<button class="vh-lang-preset-btn menu_button">${p.label}</button>`);
        $btn.on('click', () => {
            addLanguageTab(p.id, p.label);
            refreshManageList();
            $btn.prop('disabled', true).css('opacity', 0.4);
        });
        $dlg.find('#vh-lang-presets').append($btn);
    });

    // 직접 추가
    $dlg.find('#vh-custom-lang-add').on('click', () => {
        const id = $dlg.find('#vh-custom-lang-id').val().trim().toLowerCase().replace(/\s+/g, '_');
        const label = $dlg.find('#vh-custom-lang-label').val().trim();
        if (!id || !label) { toastr.warning('ID와 이름을 모두 입력하세요.'); return; }
        if (getSettings().languages.find(l => l.id === id)) { toastr.warning('이미 있는 언어 ID입니다.'); return; }
        addLanguageTab(id, label);
        $dlg.find('#vh-custom-lang-id').val('');
        $dlg.find('#vh-custom-lang-label').val('');
        refreshManageList();
    });

    function refreshManageList() {
        const $ml = $dlg.find('#vh-lang-manage-list').empty();
        getSettings().languages.forEach(l => {
            const cnt = getSettings().vocab_list.filter(v => v.lang === l.id).length;
            const $row = $(`
                <div class="vh-lang-manage-row">
                    <span class="vh-lang-manage-name">${escapeHtml(l.label)}</span>
                    <span class="vh-lang-manage-cnt">${cnt}개</span>
                    <button class="vh-lang-remove-btn menu_button" data-id="${l.id}">삭제</button>
                </div>
            `);
            $row.find('.vh-lang-remove-btn').off('click').on('click', function() {
                if (!confirm(`탭을 삭제하면 해당 단어들이 '기타'로 이동합니다. 계속할까요?`)) return;
                removeLanguageTab($(this).data('id'));
                refreshManageList();
                renderModalTabs();
                renderPanelTabs();
            });
            $ml.append($row);
        });
    }

    refreshManageList();

    $dlg.find('#vh-add-lang-close').on('click', () => {
        $dlg.remove();
        renderModalTabs();
        renderPanelTabs();
    });
    $dlg.on('click', function(e) {
        if ($(e.target).is('#vh-add-lang-overlay')) {
            $dlg.remove();
            renderModalTabs();
            renderPanelTabs();
        }
    });

    // fixed가 모바일에서 부모 transform에 영향받으므로
    // body에 붙이고 스크롤 오프셋 포함한 절대 좌표로 강제 덮어쓰기
    $(document.body).append($dlg);
    function repositionDlg() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft || 0;
        $dlg.css({
            position: 'absolute',
            top: scrollTop + 'px',
            left: scrollLeft + 'px',
            width: window.innerWidth + 'px',
            height: window.innerHeight + 'px',
            margin: '0',
            padding: '0',
            transform: 'none',
            boxSizing: 'border-box',
        });
    }
    repositionDlg();
    $(window).on('resize.vhdlg scroll.vhdlg', repositionDlg);

    // 닫힐 때 이벤트 정리
    const origClose = $dlg.find('#vh-add-lang-close');
    origClose.on('click.cleanup', () => $(window).off('resize.vhdlg scroll.vhdlg'));
    $dlg.on('click.cleanup', function(e) {
        if ($(e.target).is('#vh-add-lang-overlay')) $(window).off('resize.vhdlg scroll.vhdlg');
    });
}

function addLanguageTab(id, label) {
    const settings = getSettings();
    if (settings.languages.find(l => l.id === id)) return;
    settings.languages.push({ id, label });
    saveSettingsDebounced();
    toastr.success(`"${label}" 탭 추가됨`);
}

function removeLanguageTab(id) {
    const settings = getSettings();
    const lang = settings.languages.find(l => l.id === id);
    if (!lang) return;
    const remaining = settings.languages.filter(l => l.id !== id);
    const fallback = remaining.find(l => l.id === 'other')?.id || remaining[0]?.id || 'other';
    settings.vocab_list.forEach(v => { if (v.lang === id) v.lang = fallback; });
    settings.languages = remaining;
    if (modalActiveLang === id) modalActiveLang = 'all';
    if (panelActiveLang === id) panelActiveLang = 'all';
    saveSettingsDebounced();
    toastr.info(`탭 삭제됨 (단어들은 '${fallback}' 탭으로 이동)`);
}

// ── 툴바 버튼 ─────────────────────────────────────────────
function addToolbarButton() {
    const $btn = $(`<div id="vh-toolbar-btn" class="list-group-item flex-container flexGap5" title="단어장 열기">
        <span>📖</span><span>단어장</span>
    </div>`);
    $btn.on('click', openVocabModal);
    $('#extensionsMenu').append($btn);
}

// ── 연결 프로필 ───────────────────────────────────────────
function getConnectionProfiles() {
    const profiles = [{ value: '', label: '메인 프로필 사용 (기본)' }];
    $('#connection_profiles option').each(function() {
        const val = $(this).val();
        const text = $(this).text().trim();
        if (val && text && text !== '<None>') profiles.push({ value: val, label: text });
    });
    return profiles;
}

// ── 설정 패널 ─────────────────────────────────────────────
function buildSettingsHTML() {
    const profileOptions = getConnectionProfiles().map(a =>
        `<option value="${a.value}">${a.label}</option>`
    ).join('');

    return `
    <div id="vh-settings-block">
        <div class="vh-settings-header">
            <label class="vh-toggle-label">
                <input type="checkbox" id="vh-enabled-toggle">
                <span>단어장 기능 활성화</span>
            </label>
            <span id="vh-settings-count" class="vh-settings-count"></span>
        </div>
        <div class="vh-api-row">
            <label for="vh-api-select">번역용 프로필:</label>
            <select id="vh-api-select" class="text_pole">${profileOptions}</select>
        </div>
        <div id="vh-inline-panel">
            <div id="vh-panel-tabs" class="vh-tabs"></div>
            <div class="vh-panel-search">
                <input type="text" id="vh-search-input" class="text_pole" placeholder="단어 검색...">
            </div>
            <div id="vh-vocab-list"></div>
            <div class="vh-panel-footer">
                <button id="vh-clear-all-btn" class="menu_button">🗑 현재 탭 삭제</button>
            </div>
        </div>
    </div>`;
}

function renderPanelTabs() {
    const settings = getSettings();
    const $tabs = $('#vh-panel-tabs').empty();

    const allCount = settings.vocab_list.length;
    const $all = $(`<button class="vh-tab ${panelActiveLang === 'all' ? 'vh-tab-active' : ''}" data-lang="all">전체 <span class="vh-tab-count">${allCount}</span></button>`);
    $all.on('click', () => { panelActiveLang = 'all'; renderPanelTabs(); renderVocabList(); });
    $tabs.append($all);

    settings.languages.forEach(l => {
        const cnt = settings.vocab_list.filter(v => v.lang === l.id).length;
        const $tab = $(`<button class="vh-tab ${panelActiveLang === l.id ? 'vh-tab-active' : ''}" data-lang="${l.id}">${l.label} <span class="vh-tab-count">${cnt}</span></button>`);
        $tab.on('click', () => { panelActiveLang = l.id; renderPanelTabs(); renderVocabList(); });
        $tabs.append($tab);
    });

    const $add = $(`<button class="vh-tab vh-tab-add" title="언어 탭 추가/관리">＋</button>`);
    $add.on('click', openAddLangDialog);
    $tabs.append($add);
}

function onSettingsPanelRendered() {
    const settings = getSettings();

    $('#vh-enabled-toggle').prop('checked', settings.enabled).on('change', function() {
        settings.enabled = $(this).is(':checked');
        saveSettingsDebounced();
    });

    $('#vh-api-select').val(settings.connection_profile || '').on('change', function() {
        settings.connection_profile = $(this).val();
        saveSettingsDebounced();
    });

    $('#vh-search-input').on('input', function() {
        renderVocabList($(this).val().trim());
    });

    $('#vh-clear-all-btn').on('click', () => {
        const label = panelActiveLang === 'all' ? '전체' : '현재 탭의';
        if (!confirm(`${label} 단어를 삭제할까요?`)) return;
        const s = getSettings();
        if (panelActiveLang === 'all') {
            s.vocab_list = [];
        } else {
            s.vocab_list = s.vocab_list.filter(v => v.lang !== panelActiveLang);
        }
        saveSettingsDebounced();
        renderPanelTabs();
        renderVocabList();
        toastr.warning('삭제되었습니다.');
    });

    renderPanelTabs();
    renderVocabList();
}

// ── 텍스트 선택 감지 ──────────────────────────────────────
let selectionTimer = null;
let lastTouchEnd = 0;

function handleSelectionChange() {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
        const settings = getSettings();
        if (!settings.enabled) return;

        const selection = window.getSelection();
        const text = selection ? selection.toString().trim() : '';
        if (text.length < 1 || text.length > 200) return;

        const anchorNode = selection.anchorNode;
        if (!anchorNode) return;
        const inChat = $(anchorNode.parentElement).closest('#chat, .mes_text').length > 0;
        if (!inChat) return;

        try {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            showPopup(text, rect);
        } catch(e) {}
    }, 400);
}

function onMouseUp(e) {
    if ($(e.target).closest('#vh-popup').length) return;
    const sel = window.getSelection();
    if (!sel || sel.toString().trim() === '') hidePopup();
}

function onTouchEnd(e) {
    if ($(e.target).closest('#vh-popup').length) return;
    lastTouchEnd = Date.now();
}

// ── 팝업 표시/숨김 ─────────────────────────────────────────
let currentWord = '';
let currentTranslation = '';
let currentExplanation = '';
let currentContext = '';
let currentPronunciation = '';
let currentLang = 'other';

function showPopup(text, rect) {
    currentWord = text;
    currentTranslation = '';
    currentExplanation = '';
    currentPronunciation = '';
    currentLang = detectLanguage(text);

    const selection = window.getSelection();
    currentContext = selection?.anchorNode?.parentElement?.textContent?.trim().slice(0, 300) || '';

    $popup.find('.vh-selected-word').text(text.length > 40 ? text.slice(0, 40) + '…' : text);
    $popup.find('.vh-loading').show().text('번역 중...');
    $popup.find('.vh-result').hide();
    $popup.find('.vh-save-btn').hide();
    $popup.find('.vh-saved-badge').hide();
    $popup.find('.vh-pronunciation').hide();
    $popup.find('.vh-lang-select-row').hide();

    const settings = getSettings();
    if (settings.vocab_list.some(v => v.word === text)) {
        $popup.find('.vh-saved-badge').show();
    }

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    $popup.css({ display: 'block', visibility: 'hidden', top: 0, left: 0 });
    $popup.data('anchor-rect', rect);
    $popup.data('scroll-top', scrollTop);
    $popup.data('scroll-left', scrollLeft);
    $popup.css({ visibility: 'visible' });

    fetchTranslation(text, currentContext);
}

function hidePopup() {
    $popup.hide();
    const active = document.activeElement;
    if (!active || (active.tagName !== 'TEXTAREA' && active.tagName !== 'INPUT')) {
        window.getSelection()?.removeAllRanges();
    }
}

// ── 번역 요청 ──────────────────────────────────────────────
async function fetchTranslation(text, context) {
    try {
        const safeText = text.replace(/`/g, "'").replace(/\\/g, '');

        const prompt = [
            `아래 단어를 한국어 사전처럼 설명해줘. 반드시 아래 형식만 사용해.`,
            `단어: ${safeText}`,
            ``,
            `발음기호: IPA 발음기호 (예: /ˈæpl/)`,
            `뜻1: (품사) 한국어 뜻`,
            `뜻2: (품사) 한국어 뜻`,
            `뜻3: (품사) 한국어 뜻`,
            `예문: 짧은 영어 예문`,
            ``,
            `위 형식 외 다른 말 하지 마. 각 줄은 반드시 한 줄로 끝내.`,
        ].filter(Boolean).join('\n');

        const ctx = getSTContext();
        const { generateRaw, chat } = ctx;
        if (typeof generateRaw !== 'function') throw new Error('API 함수 없음');

        const settings = getSettings();
        const profileId = settings.connection_profile || '';

        let prevProfile = '';
        if (profileId) {
            prevProfile = $('#connection_profiles').val() || '';
            $('#connection_profiles').val(profileId).trigger('change');
            await new Promise(r => setTimeout(r, 400));
        }

        const { chatCompletionSettings } = getSTContext();
        const savedMaxTokens = chatCompletionSettings?.openai_max_tokens;
        if (chatCompletionSettings && savedMaxTokens !== undefined && savedMaxTokens < 800) {
            chatCompletionSettings.openai_max_tokens = 800;
        }

        const savedChat = chat ? [...chat] : null;
        if (savedChat) chat.length = 0;

        const fields = ['#char_description', '#char_personality', '#scenario_pole', '#system_prompt', '#world_info_character_strategy'];
        const savedFields = fields.map(sel => ({ sel, val: $(sel).val() }));
        savedFields.forEach(f => $(f.sel).val(''));

        let raw = '';
        try {
            raw = await generateRaw({ prompt, quietToLoud: false, skipWIAN: true });
        } finally {
            if (chatCompletionSettings && savedMaxTokens !== undefined) {
                chatCompletionSettings.openai_max_tokens = savedMaxTokens;
            }
            savedFields.forEach(f => $(f.sel).val(f.val));
            if (savedChat) {
                chat.length = 0;
                savedChat.forEach(m => chat.push(m));
            }
            if (profileId && prevProfile) {
                $('#connection_profiles').val(prevProfile).trigger('change');
            }
        }

        if (!raw || !raw.trim()) throw new Error('빈 응답');
        console.log('[VocabHelper] raw:', raw);

        const pron = raw.match(/발음기호\s*[:：]\s*(.+)/);
        const m1 = raw.match(/뜻\s*1\s*[:：]\s*(.+)/);
        const m2 = raw.match(/뜻\s*2\s*[:：]\s*(.+)/);
        const m3 = raw.match(/뜻\s*3\s*[:：]\s*(.+)/);
        const ex = raw.match(/예문\s*[:：]\s*(.+)/);

        if (pron) {
            currentPronunciation = pron[1].trim();
            $popup.find('.vh-pronunciation').text(currentPronunciation).show();
        }

        let meanings = [m1, m2, m3].filter(Boolean).map((m, i) => `${i + 1}. ${m[1].trim()}`);

        if (meanings.length === 0) {
            const jsonMatch = raw.match(/\{[\s\S]+?\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    const exp = parsed.explanation || parsed.meaning || parsed.translation || '';
                    if (exp) meanings = exp.split(/[.。\n]/).filter(s => s.trim()).slice(0, 3).map((s, i) => `${i + 1}. ${s.trim()}`);
                } catch (e) {}
            }
        }

        if (meanings.length === 0) {
            meanings = raw.trim().split('\n').filter(l => l.trim()).slice(0, 3).map((l, i) => `${i + 1}. ${l.trim()}`);
        }

        if (meanings.length === 0) throw new Error('번역 결과 없음');

        const example = ex ? `예문: ${ex[1].trim()}` : '';
        currentTranslation = text;
        currentExplanation = [...meanings, example].filter(Boolean).join('\n');

        $popup.find('.vh-loading').hide();
        $popup.find('.vh-translation').text(currentTranslation);
        $popup.find('.vh-explanation').html(currentExplanation.replace(/\n/g, '<br>'));
        $popup.find('.vh-result').show();

        // 언어 선택 드롭다운 표시
        updatePopupLangSelect();
        $popup.find('.vh-lang-select').val(currentLang);
        $popup.find('.vh-lang-select-row').show();

        setTimeout(() => {
            const rect2 = $popup.data('anchor-rect');
            const scrollTop2 = $popup.data('scroll-top') || 0;
            if (rect2 && $popup.is(':visible')) {
                const popupH2 = $popup.outerHeight();
                const popupW2 = $popup.outerWidth();
                let top2 = rect2.top + scrollTop2 - popupH2 - 8;
                if (top2 < scrollTop2 + 8) top2 = rect2.bottom + scrollTop2 + 8;
                let left2 = Math.max(8, Math.min(rect2.left + rect2.width / 2 - popupW2 / 2, window.innerWidth - popupW2 - 8));
                $popup.css({ top: `${top2}px`, left: `${left2}px` });
            }
        }, 50);

        if (!settings.vocab_list.some(v => v.word === text)) {
            $popup.find('.vh-save-btn').show();
        }

    } catch (err) {
        $popup.find('.vh-loading').text('번역 실패: ' + err.message);
        console.error('[VocabHelper]', err);
    }
}

// ── 단어 저장 ──────────────────────────────────────────────
function saveCurrentWord() {
    if (!currentWord || !currentExplanation) return;

    const settings = getSettings();
    if (settings.vocab_list.find(v => v.word === currentWord)) return;

    const selectedLang = $popup.find('.vh-lang-select').val() || currentLang;

    settings.vocab_list.unshift({
        word: currentWord,
        pronunciation: currentPronunciation,
        translation: currentTranslation,
        explanation: currentExplanation,
        context: currentContext.slice(0, 150),
        lang: selectedLang,
        date: new Date().toLocaleDateString('ko-KR'),
    });

    saveSettingsDebounced();
    $popup.find('.vh-save-btn').hide();
    $popup.find('.vh-saved-badge').show();
    if ($('#vh-vocab-list').length) {
        renderPanelTabs();
        renderVocabList();
    }
    if ($('#vh-modal-vocab-list').length && $vocabModal.is(':visible')) {
        renderModalTabs();
        renderModalVocabList();
    }
    toastr.success(`"${currentWord}" 단어장에 저장됨`);
}

// ── 단어장 렌더링 (설정 패널) ─────────────────────────────
function renderVocabList(filter = '') {
    const $list = $('#vh-vocab-list');
    if (!$list.length) return;

    const settings = getSettings();
    let list = panelActiveLang === 'all'
        ? settings.vocab_list
        : settings.vocab_list.filter(v => v.lang === panelActiveLang);

    if (filter) {
        const f = filter.toLowerCase();
        list = list.filter(v =>
            v.word.toLowerCase().includes(f) ||
            (v.explanation || '').toLowerCase().includes(f)
        );
    }

    $('#vh-settings-count').text(`${settings.vocab_list.length}개 저장됨`);
    $list.empty();

    if (list.length === 0) {
        $list.append('<div class="vh-empty">저장된 단어가 없습니다.</div>');
        return;
    }

    list.forEach((item) => {
        const realIdx = settings.vocab_list.indexOf(item);
        const langLabel = panelActiveLang === 'all'
            ? (settings.languages.find(l => l.id === item.lang)?.label || item.lang || '')
            : '';
        $list.append(buildVocabItemEl(item, realIdx, langLabel, false));
    });
}


// ══════════════════════════════════════════════════════════
// ── 퀴즈 모드 ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════

let $quizModal = null;

const quiz = {
    deck: [],
    cursor: 0,
    wrong: [],
    mode: 'quiz',
    phase: 'typing',
    langFilter: 'all',
    limit: 0,           // 0 = 전체
};

function createQuizModal() {
    $quizModal = $(`
        <div id="vh-quiz-overlay" style="display:none;">
            <div id="vh-quiz-modal">
                <div class="vh-quiz-header">
                    <span id="vh-quiz-title">📝 단어 시험</span>
                    <div class="vh-quiz-header-right">
                        <span id="vh-quiz-progress"></span>
                        <button class="vh-quiz-close">✕</button>
                    </div>
                </div>
                <div id="vh-quiz-body"></div>
            </div>
        </div>
    `);
    $quizModal.find('.vh-quiz-close').on('click', closeQuizModal);
    $quizModal.on('click', function(e) {
        if ($(e.target).is('#vh-quiz-overlay')) closeQuizModal();
    });
    $(document.body).append($quizModal);
    function reposQuiz() {
        const st = window.scrollY || document.documentElement.scrollTop || 0;
        const sl = window.scrollX || document.documentElement.scrollLeft || 0;
        $quizModal.css({
            position: 'absolute', top: st + 'px', left: sl + 'px',
            width: window.innerWidth + 'px', height: window.innerHeight + 'px',
            margin: '0', padding: '0', transform: 'none', boxSizing: 'border-box',
        });
    }
    reposQuiz();
    $(window).on('resize.vhquiz scroll.vhquiz', reposQuiz);
}

function openQuizModal() {
    renderQuizStartScreen();
    $quizModal.show();
}

function closeQuizModal() {
    $quizModal.hide();
}

function renderQuizStartScreen() {
    const settings = getSettings();
    const $body = $('#vh-quiz-body');
    $('#vh-quiz-title').text('📝 단어 시험');
    $('#vh-quiz-progress').text('');

    const langOptions = [
        { id: 'all', label: '전체' },
        ...settings.languages.map(l => ({ id: l.id, label: l.label })),
    ].map(l => {
        const cnt = l.id === 'all'
            ? settings.vocab_list.length
            : settings.vocab_list.filter(v => v.lang === l.id).length;
        return `<option value="${l.id}">${l.label} (${cnt}개)</option>`;
    }).join('');

    const wrongCount = settings.wrong_list?.length || 0;

    $body.html(buildStartHTML(langOptions, wrongCount));

    $('#vh-quiz-lang-sel').val(quiz.langFilter);
    $('#vh-quiz-lang-sel').on('change', function() { quiz.langFilter = $(this).val(); });

    // 문제 수 버튼
    function updateCountButtons(val) {
        quiz.limit = val;
        $('.vh-quiz-count-btn').removeClass('vh-quiz-count-active');
        $(`.vh-quiz-count-btn[data-val="${val}"]`).addClass('vh-quiz-count-active');
        if (val === 0) {
            $('#vh-quiz-count-input').val('');
        } else {
            $('#vh-quiz-count-input').val(val);
        }
    }
    // 초기 상태 반영
    updateCountButtons(quiz.limit);

    $('.vh-quiz-count-btn').on('click', function() {
        updateCountButtons(parseInt($(this).data('val')));
    });
    $('#vh-quiz-count-input').on('input', function() {
        const v = parseInt($(this).val());
        quiz.limit = (!v || v < 1) ? 0 : v;
        $('.vh-quiz-count-btn').removeClass('vh-quiz-count-active');
        if (!v || v < 1) $(`.vh-quiz-count-btn[data-val="0"]`).addClass('vh-quiz-count-active');
    });

    $('#vh-quiz-start-all').on('click', () => startQuiz('quiz'));
    $('#vh-quiz-start-wrong').on('click', () => { if (wrongCount > 0) startQuiz('wrong'); });
    $('#vh-quiz-wrongnote-btn').on('click', renderWrongNote);
}

function buildStartHTML(langOptions, wrongCount) {
    return `
        <div class="vh-quiz-start">
            <div class="vh-quiz-start-section">
                <div class="vh-quiz-label">대상 언어</div>
                <select id="vh-quiz-lang-sel" class="text_pole">${langOptions}</select>
            </div>
            <div class="vh-quiz-start-section">
                <div class="vh-quiz-label">문제 수</div>
                <div class="vh-quiz-count-row">
                    <button class="vh-quiz-count-btn" data-val="5">5개</button>
                    <button class="vh-quiz-count-btn" data-val="10">10개</button>
                    <button class="vh-quiz-count-btn" data-val="15">15개</button>
                    <button class="vh-quiz-count-btn" data-val="20">20개</button>
                    <button class="vh-quiz-count-btn ${quiz.limit === 0 ? 'vh-quiz-count-active' : ''}" data-val="0">전체</button>
                </div>
                <div class="vh-quiz-count-custom-row">
                    <input type="number" id="vh-quiz-count-input" class="text_pole vh-quiz-count-input" min="1" max="999" placeholder="직접 입력">
                    <span class="vh-quiz-count-unit">개</span>
                </div>
            </div>
            <div class="vh-quiz-start-section">
                <div class="vh-quiz-label">시험 방식</div>
                <div class="vh-quiz-mode-btns">
                    <button class="vh-quiz-start-btn menu_button" id="vh-quiz-start-all">
                        🎲 전체 시험
                        <span class="vh-quiz-start-sub">단어 전체를 랜덤으로</span>
                    </button>
                    <button class="vh-quiz-start-btn menu_button ${wrongCount === 0 ? 'vh-quiz-btn-disabled' : ''}" id="vh-quiz-start-wrong" ${wrongCount === 0 ? 'disabled' : ''}>
                        ❌ 오답 재시험
                        <span class="vh-quiz-start-sub">${wrongCount}개 오답 단어만</span>
                    </button>
                </div>
            </div>
            ${wrongCount > 0 ? `<div class="vh-quiz-start-section">
                <div class="vh-quiz-label">오답 노트</div>
                <button class="menu_button vh-quiz-wide-btn" id="vh-quiz-wrongnote-btn">📋 오답 목록 보기</button>
            </div>` : ''}
        </div>
    `;
}

function startQuiz(mode) {
    const settings = getSettings();
    quiz.mode = mode;
    quiz.cursor = 0;
    quiz.wrong = [];

    let pool = mode === 'wrong'
        ? (settings.wrong_list || [])
        : settings.vocab_list;

    if (quiz.langFilter !== 'all') {
        pool = pool.filter(v => v.lang === quiz.langFilter);
    }

    if (pool.length < 1) {
        toastr.warning('시험 볼 단어가 없습니다.');
        return;
    }

    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const sliced = (quiz.limit > 0) ? shuffled.slice(0, quiz.limit) : shuffled;
    quiz.deck = sliced.map(v => ({
        ...v,
        direction: Math.random() < 0.5 ? 'word2meaning' : 'meaning2word',
    }));

    renderQuizQuestion();
}

function renderQuizQuestion() {
    if (quiz.cursor >= quiz.deck.length) {
        renderQuizResult();
        return;
    }

    const q = quiz.deck[quiz.cursor];
    quiz.phase = 'typing';
    const total = quiz.deck.length;
    const cur = quiz.cursor + 1;

    $('#vh-quiz-title').text(quiz.mode === 'wrong' ? '❌ 오답 재시험' : '📝 단어 시험');
    $('#vh-quiz-progress').text(`${cur} / ${total}`);

    let prompt, placeholder, answerHint;
    if (q.direction === 'word2meaning') {
        prompt = `<span class="vh-quiz-qword">${escapeHtml(q.word)}</span>${q.pronunciation ? `<span class="vh-quiz-pron">${escapeHtml(q.pronunciation)}</span>` : ''}`;
        placeholder = '한국어 뜻을 입력하세요';
        answerHint = q.explanation || '';
    } else {
        const firstMeaning = (q.explanation || '').split('\n')[0] || '';
        prompt = `<span class="vh-quiz-qmeaning">${escapeHtml(firstMeaning)}</span>`;
        placeholder = '영단어를 입력하세요';
        answerHint = q.word;
    }

    $('#vh-quiz-body').html(`
        <div class="vh-quiz-card">
            <div class="vh-quiz-direction-badge">${q.direction === 'word2meaning' ? '단어 → 뜻' : '뜻 → 단어'}</div>
            <div class="vh-quiz-prompt">${prompt}</div>
            <div class="vh-quiz-input-area">
                <input type="text" id="vh-quiz-input" class="text_pole vh-quiz-input" placeholder="${placeholder}" autocomplete="off" autocorrect="off" spellcheck="false">
                <button class="menu_button vh-quiz-submit-btn" id="vh-quiz-submit">확인</button>
            </div>
            <div id="vh-quiz-feedback" class="vh-quiz-feedback" style="display:none;"></div>
            <div class="vh-quiz-nav">
                <button class="menu_button vh-quiz-skip-btn" id="vh-quiz-skip">건너뛰기</button>
            </div>
        </div>
    `);

    const $input = $('#vh-quiz-input');
    $input.focus();

    $('#vh-quiz-submit').on('click', () => submitTypingAnswer(q, answerHint));
    $input.on('keydown', function(e) {
        if (e.key === 'Enter') submitTypingAnswer(q, answerHint);
    });
    $('#vh-quiz-skip').on('click', () => {
        recordWrong(q, '(건너뜀)');
        showAnswerFeedback(q, answerHint, false, true);
    });
}

function submitTypingAnswer(q, answerHint) {
    const userInput = $('#vh-quiz-input').val().trim();
    if (!userInput) return;
    const correct = checkAnswer(userInput, q);
    if (correct) {
        showAnswerFeedback(q, answerHint, true, false);
    } else {
        renderChoicePhase(q, answerHint, userInput);
    }
}

function checkAnswer(input, q) {
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').trim();
    const inp = normalize(input);
    if (q.direction === 'word2meaning') {
        const lines = (q.explanation || '').split('\n');
        return lines.some(line => {
            const stripped = normalize(line.replace(/^\d+\.\s*(\(.*?\)\s*)?/, ''));
            return stripped.length >= 2 && inp.length >= 2 && (stripped.includes(inp) || inp.includes(stripped.slice(0, Math.max(4, stripped.length - 2))));
        });
    } else {
        return normalize(q.word) === inp;
    }
}

function renderChoicePhase(q, answerHint, prevTyped) {
    quiz.phase = 'choice';
    const settings = getSettings();
    const pool = settings.vocab_list.filter(v => v.word !== q.word);
    const shufflePool = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);

    let choices;
    if (q.direction === 'word2meaning') {
        const correct = (q.explanation || '').split('\n')[0] || q.word;
        choices = [
            { text: correct, correct: true },
            ...shufflePool.map(v => ({ text: (v.explanation || '').split('\n')[0] || v.word, correct: false })),
        ];
    } else {
        choices = [
            { text: q.word, correct: true },
            ...shufflePool.map(v => ({ text: v.word, correct: false })),
        ];
    }
    choices = choices.sort(() => Math.random() - 0.5);

    $('.vh-quiz-input-area').hide();
    $('#vh-quiz-skip').hide();

    $('#vh-quiz-feedback').html(`
        <div class="vh-quiz-choice-hint">❌ 틀렸어요! <span class="vh-quiz-typed">"${escapeHtml(prevTyped)}"</span><br>객관식으로 재도전해보세요</div>
        <div class="vh-quiz-choices">
            ${choices.map((c, i) => `
                <button class="vh-quiz-choice-btn menu_button" data-correct="${c.correct}" data-idx="${i}">
                    ${escapeHtml(c.text.length > 80 ? c.text.slice(0, 80) + '…' : c.text)}
                </button>
            `).join('')}
        </div>
    `).show();

    $('#vh-quiz-feedback .vh-quiz-choice-btn').on('click', function() {
        const isCorrect = $(this).data('correct') === true || $(this).data('correct') === 'true';
        $('#vh-quiz-feedback .vh-quiz-choice-btn').each(function() {
            const c = $(this).data('correct') === true || $(this).data('correct') === 'true';
            $(this).addClass(c ? 'vh-quiz-choice-correct' : 'vh-quiz-choice-wrong').prop('disabled', true);
        });
        if (!isCorrect) recordWrong(q, prevTyped);
        setTimeout(() => showAnswerFeedback(q, answerHint, isCorrect, false, true), 700);
    });
}

function showAnswerFeedback(q, answerHint, correct, skipped, fromChoice = false) {
    if (!correct && !skipped && !fromChoice) recordWrong(q, '');

    const shortAnswer = q.direction === 'word2meaning'
        ? (q.explanation || '').split('\n').slice(0, 2).join(' / ')
        : q.word;

    const resultHtml = correct
        ? `<div class="vh-quiz-result-correct">✅ 정답!</div>`
        : skipped
            ? `<div class="vh-quiz-result-wrong">⏭ 건너뜀</div>`
            : `<div class="vh-quiz-result-wrong">❌ 오답</div>`;

    $('.vh-quiz-card').find('#vh-quiz-feedback').remove();
    $('.vh-quiz-card').find('.vh-quiz-input-area').hide();
    $('.vh-quiz-card').find('.vh-quiz-nav').hide();
    $('.vh-quiz-card').append(`
        <div class="vh-quiz-answer-reveal">
            ${resultHtml}
            <div class="vh-quiz-answer-label">정답</div>
            <div class="vh-quiz-answer-text">${escapeHtml(shortAnswer)}</div>
            <button class="menu_button vh-quiz-next-btn" id="vh-quiz-next">다음 →</button>
        </div>
    `);

    $('#vh-quiz-next').on('click', () => {
        quiz.cursor++;
        renderQuizQuestion();
    });
}

function recordWrong(q, userAnswer) {
    if (quiz.wrong.find(w => w.word === q.word && w.direction === q.direction)) return;
    quiz.wrong.push({ ...q, userAnswer });
}

function renderQuizResult() {
    const total = quiz.deck.length;
    const wrongCount = quiz.wrong.length;
    const correct = total - wrongCount;
    const pct = Math.round((correct / total) * 100);

    const settings = getSettings();
    if (!settings.wrong_list) settings.wrong_list = [];
    quiz.wrong.forEach(w => {
        if (!settings.wrong_list.find(x => x.word === w.word)) {
            settings.wrong_list.unshift(w);
        }
    });
    const correctWords = quiz.deck
        .filter(q => !quiz.wrong.find(w => w.word === q.word))
        .map(q => q.word);
    settings.wrong_list = settings.wrong_list.filter(w => !correctWords.includes(w.word));
    saveSettingsDebounced();

    const emoji = pct === 100 ? '🏆' : pct >= 70 ? '🎉' : pct >= 40 ? '😅' : '😢';

    $('#vh-quiz-title').text('결과');
    $('#vh-quiz-progress').text('');
    $('#vh-quiz-body').html(`
        <div class="vh-quiz-result">
            <div class="vh-quiz-result-emoji">${emoji}</div>
            <div class="vh-quiz-result-score">${correct} / ${total}</div>
            <div class="vh-quiz-result-pct">${pct}%</div>
            <div class="vh-quiz-result-sub">${wrongCount > 0 ? `오답 ${wrongCount}개` : '전부 정답! 🎊'}</div>
            <div class="vh-quiz-result-btns">
                ${wrongCount > 0 ? `<button class="menu_button" id="vh-quiz-retry-wrong">❌ 오답만 재시험 (${wrongCount}개)</button>` : ''}
                <button class="menu_button" id="vh-quiz-retry-all">🔄 전체 다시</button>
                ${wrongCount > 0 ? `<button class="menu_button" id="vh-quiz-see-wrong">📋 오답 보기</button>` : ''}
                <button class="menu_button" id="vh-quiz-back">← 처음으로</button>
            </div>
        </div>
    `);

    $('#vh-quiz-retry-wrong').on('click', () => startQuiz('wrong'));
    $('#vh-quiz-retry-all').on('click', () => startQuiz('quiz'));
    $('#vh-quiz-see-wrong').on('click', renderWrongNote);
    $('#vh-quiz-back').on('click', renderQuizStartScreen);
}

function renderWrongNote() {
    const settings = getSettings();
    const list = settings.wrong_list || [];

    $('#vh-quiz-title').text('📋 오답 노트');
    $('#vh-quiz-progress').text(`${list.length}개`);

    if (list.length === 0) {
        $('#vh-quiz-body').html(`<div class="vh-empty" style="padding:40px 0;">오답이 없습니다 🎉</div>`);
        return;
    }

    const items = list.map((w, i) => `
        <div class="vh-wrong-item">
            <div class="vh-wrong-item-header">
                <span class="vh-vocab-word">${escapeHtml(w.word)}</span>
                ${w.pronunciation ? `<span class="vh-vocab-pronunciation">${escapeHtml(w.pronunciation)}</span>` : ''}
                <button class="vh-delete-btn vh-wrong-del-btn" data-idx="${i}" title="오답노트에서 제거">🗑</button>
            </div>
            <div class="vh-wrong-explanation">${escapeHtml((w.explanation || '').split('\n').slice(0, 2).join(' / '))}</div>
        </div>
    `).join('');

    $('#vh-quiz-body').html(`
        <div class="vh-wrong-note">
            <div class="vh-wrong-list">${items}</div>
            <div class="vh-wrong-note-footer">
                <button class="menu_button" id="vh-wrong-start">❌ 오답 재시험</button>
                <button class="menu_button" id="vh-wrong-clear">🗑 초기화</button>
                <button class="menu_button" id="vh-wrong-back">← 돌아가기</button>
            </div>
        </div>
    `);

    $('.vh-wrong-del-btn').on('click', function() {
        const idx = parseInt($(this).data('idx'));
        settings.wrong_list.splice(idx, 1);
        saveSettingsDebounced();
        renderWrongNote();
    });
    $('#vh-wrong-start').on('click', () => startQuiz('wrong'));
    $('#vh-wrong-clear').on('click', () => {
        if (!confirm('오답 노트를 초기화할까요?')) return;
        settings.wrong_list = [];
        saveSettingsDebounced();
        renderWrongNote();
    });
    $('#vh-wrong-back').on('click', renderQuizStartScreen);
}

// ── 유틸 ───────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── 초기화 ─────────────────────────────────────────────────
jQuery(async () => {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(defaultSettings);
    }

    createPopup();
    createVocabModal();
    createQuizModal();
    addToolbarButton();

    const settingsHtml = buildSettingsHTML();
    $('#extensions_settings').append(`
        <div id="vocab_helper_container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>📖 Chationary</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    ${settingsHtml}
                </div>
            </div>
        </div>
    `);

    onSettingsPanelRendered();

    document.addEventListener('selectionchange', handleSelectionChange);
    $(document).on('mouseup', onMouseUp);
    $(document).on('touchend', onTouchEnd);
    $(document).on('mousedown', function(e) {
        if (!$(e.target).closest('#vh-popup').length && $popup.is(':visible')) {
            const sel = window.getSelection();
            if (!sel || sel.toString().trim() === '') hidePopup();
        }
    });

    console.log('[VocabHelper] 확장 로드 완료');
});
