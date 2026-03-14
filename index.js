// Vocab Helper Extension for SillyTavern
// 드래그로 단어/문장 선택 → 팝업 번역 + 단어장 저장

import { saveSettingsDebounced } from '../../../script.js';
import { extension_settings } from '../../extensions.js';

function getSTContext() {
    return window.SillyTavern?.getContext() || {};
}

const EXT_NAME = 'vocab-helper';

// ── 기본 설정 ──────────────────────────────────────────────
const defaultSettings = {
    vocab_list: [],
    enabled: true,
    connection_profile: '',   // 번역용 연결 프로필 UUID ('' = 메인 프로필 사용)
};

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(defaultSettings);
    }
    // 기존 저장값에 새 필드 없으면 추가
    if (extension_settings[EXT_NAME].connection_profile === undefined) {
        extension_settings[EXT_NAME].connection_profile = '';
    }
    return extension_settings[EXT_NAME];
}

// ── 팝업 DOM ───────────────────────────────────────────────
let $popup = null;

function createPopup() {
    $popup = $(`
        <div id="vh-popup" style="display:none;">
            <div class="vh-popup-header">
                <span class="vh-selected-word"></span>
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
                <button class="vh-save-btn" style="display:none;">📖 단어장에 저장</button>
                <span class="vh-saved-badge" style="display:none;">✅ 저장됨</span>
            </div>
        </div>
    `);
    $popup.find('.vh-close-btn').on('click', hidePopup);
    $popup.find('.vh-save-btn').on('click', saveCurrentWord);
    $('body').append($popup);
}

// ── 단어장 모달 ───────────────────────────────────────────
let $vocabModal = null;

function createVocabModal() {
    $vocabModal = $(`
        <div id="vh-modal-overlay" style="display:none;">
            <div id="vh-modal">
                <div class="vh-modal-header">
                    <span>📖 내 단어장</span>
                    <div class="vh-modal-header-right">
                        <span id="vh-modal-count"></span>
                        <button class="vh-modal-close">✕</button>
                    </div>
                </div>
                <div class="vh-modal-search">
                    <input type="text" id="vh-modal-search-input" class="text_pole" placeholder="단어 검색...">
                </div>
                <div id="vh-modal-vocab-list"></div>
                <div class="vh-modal-footer">
                    <button id="vh-modal-clear-btn" class="menu_button">🗑 전체 삭제</button>
                </div>
            </div>
        </div>
    `);
    $vocabModal.find('.vh-modal-close').on('click', closeVocabModal);
    $vocabModal.on('click', function(e) {
        if ($(e.target).is('#vh-modal-overlay')) closeVocabModal();
    });
    $vocabModal.find('#vh-modal-search-input').on('input', function() {
        renderModalVocabList($(this).val().trim());
    });
    $vocabModal.find('#vh-modal-clear-btn').on('click', function() {
        if (!confirm('단어장을 전체 삭제할까요?')) return;
        const settings = getSettings();
        settings.vocab_list = [];
        saveSettingsDebounced();
        renderModalVocabList();
        renderVocabList();
        toastr.warning('단어장이 초기화되었습니다.');
    });
    // 반드시 body 최상위에 붙여서 다른 요소 영향 안 받게
    $(document.body).append($vocabModal);
    $vocabModal.css({
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
    });
}

function openVocabModal() {
    renderModalVocabList();
    $vocabModal.show();
}

function closeVocabModal() {
    $vocabModal.hide();
}

function renderModalVocabList(filter = '') {
    const settings = getSettings();
    const list = filter
        ? settings.vocab_list.filter(v =>
            v.word.toLowerCase().includes(filter.toLowerCase()) ||
            (v.explanation || '').includes(filter))
        : settings.vocab_list;

    $('#vh-modal-count').text(`${settings.vocab_list.length}개 저장됨`);
    const $list = $('#vh-modal-vocab-list').empty();

    if (list.length === 0) {
        $list.append('<div class="vh-empty">저장된 단어가 없습니다.</div>');
        return;
    }

    list.forEach((item) => {
        const realIdx = settings.vocab_list.indexOf(item);
        const $item = $(`
            <div class="vh-vocab-item">
                <div class="vh-vocab-item-header">
                    <span class="vh-vocab-word">${escapeHtml(item.word)}</span>
                    <div class="vh-vocab-item-actions">
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
            const word = settings.vocab_list[idx]?.word;
            settings.vocab_list.splice(idx, 1);
            saveSettingsDebounced();
            renderModalVocabList($('#vh-modal-search-input').val()?.trim() || '');
            renderVocabList();
            toastr.info(`"${word}" 삭제됨`);
        });
        $list.append($item);
    });
}

// ── 툴바 버튼 (마법봉 메뉴) ───────────────────────────────
function addToolbarButton() {
    const $btn = $(`<div id="vh-toolbar-btn" class="list-group-item flex-container flexGap5" title="단어장 열기">
        <span>📖</span><span>단어장</span>
    </div>`);
    $btn.on('click', openVocabModal);
    $('#extensionsMenu').append($btn);
}

// ── 연결 프로필 목록 가져오기 ─────────────────────────────
function getConnectionProfiles() {
    const profiles = [{ value: '', label: '메인 프로필 사용 (기본)' }];
    $('#connection_profiles option').each(function() {
        const val = $(this).val();
        const text = $(this).text().trim();
        if (val && text && text !== '<None>') {
            profiles.push({ value: val, label: text });
        }
    });
    return profiles;
}

// ── 확장 설정 패널 ─────────────────────────────────────────
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
            <select id="vh-api-select" class="text_pole">
                ${profileOptions}
            </select>
        </div>
        <div id="vh-inline-panel">
            <div class="vh-panel-search">
                <input type="text" id="vh-search-input" class="text_pole" placeholder="단어 검색...">
            </div>
            <div id="vh-vocab-list"></div>
            <div class="vh-panel-footer">
                <button id="vh-clear-all-btn" class="menu_button">🗑 전체 삭제</button>
            </div>
        </div>
    </div>`;
}

function onSettingsPanelRendered() {
    const settings = getSettings();

    $('#vh-enabled-toggle').prop('checked', settings.enabled).on('change', function() {
        settings.enabled = $(this).is(':checked');
        saveSettingsDebounced();
    });

    // 연결 프로필 선택 초기값 및 변경 핸들러
    $('#vh-api-select').val(settings.connection_profile || '').on('change', function() {
        settings.connection_profile = $(this).val();
        saveSettingsDebounced();
    });

    $('#vh-search-input').on('input', function() {
        renderVocabList($(this).val().trim());
    });

    $('#vh-clear-all-btn').on('click', clearAllVocab);

    renderVocabList();
}

// ── 텍스트 선택 감지 (PC + 모바일 공통) ──────────────────
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

        // 선택 범위 위치
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
    // 빈 클릭이면 팝업 닫기
    const sel = window.getSelection();
    if (!sel || sel.toString().trim() === '') {
        hidePopup();
    }
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

function showPopup(text, rect) {
    currentWord = text;
    currentTranslation = '';
    currentExplanation = '';

    const selection = window.getSelection();
    currentContext = selection?.anchorNode?.parentElement?.textContent?.trim().slice(0, 300) || '';

    $popup.find('.vh-selected-word').text(text.length > 40 ? text.slice(0, 40) + '…' : text);
    $popup.find('.vh-loading').show().text('번역 중...');
    $popup.find('.vh-result').hide();
    $popup.find('.vh-save-btn').hide();
    $popup.find('.vh-saved-badge').hide();

    const settings = getSettings();
    if (settings.vocab_list.some(v => v.word === text)) {
        $popup.find('.vh-saved-badge').show();
    }

    // 일단 보이지 않게 띄워서 초기 위치 잡기
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    $popup.css({ display: 'block', visibility: 'hidden', top: 0, left: 0 });

    // 위치는 번역 완료 후 재계산하기 위해 rect 저장
    $popup.data('anchor-rect', rect);
    $popup.data('scroll-top', scrollTop);
    $popup.data('scroll-left', scrollLeft);
    $popup.css({ visibility: 'visible' });

    fetchTranslation(text, currentContext);
}

function hidePopup() {
    $popup.hide();
    window.getSelection()?.removeAllRanges();
}

// ── 번역 요청 ──────────────────────────────────────────────
async function fetchTranslation(text, context) {
    try {
        const safeText = text.replace(/`/g, "'").replace(/\\/g, '');

        const prompt = [
            `아래 단어를 한국어 사전처럼 설명해줘. 반드시 아래 형식만 사용해.`,
            `단어: ${safeText}`,
            ``,
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

        // 프로필 임시 전환
        let prevProfile = '';
        if (profileId) {
            prevProfile = $('#connection_profiles').val() || '';
            $('#connection_profiles').val(profileId).trigger('change');
            await new Promise(r => setTimeout(r, 400));
        }

        // 응답 길이 임시로 늘리기
        const { chatCompletionSettings } = getSTContext();
        const savedMaxTokens = chatCompletionSettings?.openai_max_tokens;
        if (chatCompletionSettings && savedMaxTokens !== undefined && savedMaxTokens < 800) {
            chatCompletionSettings.openai_max_tokens = 800;
        }

        // 채팅 히스토리 + 캐릭터 설정 임시 제거 (안전 필터 우회)
        const savedChat = chat ? [...chat] : null;
        if (savedChat) chat.length = 0;

        // 캐릭터 관련 필드 임시 비우기
        const fields = ['#char_description', '#char_personality', '#scenario_pole', '#system_prompt', '#world_info_character_strategy'];
        const savedFields = fields.map(sel => ({ sel, val: $(sel).val() }));
        savedFields.forEach(f => $(f.sel).val(''));

        let raw = '';
        try {
            raw = await generateRaw({
                prompt,
                quietToLoud: false,
                skipWIAN: true,
            });
        } finally {
            // 응답 길이 복원
            if (chatCompletionSettings && savedMaxTokens !== undefined) {
                chatCompletionSettings.openai_max_tokens = savedMaxTokens;
            }
            // 복원
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

        // ── 파싱: 뜻1/2/3 + 예문 형식 ──
        const m1 = raw.match(/뜻\s*1\s*[:：]\s*(.+)/);
        const m2 = raw.match(/뜻\s*2\s*[:：]\s*(.+)/);
        const m3 = raw.match(/뜻\s*3\s*[:：]\s*(.+)/);
        const ex = raw.match(/예문\s*[:：]\s*(.+)/);

        let meanings = [m1, m2, m3].filter(Boolean).map((m, i) => `${i + 1}. ${m[1].trim()}`);

        // fallback: JSON 응답 처리
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

        // fallback: 줄 단위
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

        // DOM 렌더 완료 후 위치 재계산
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

    settings.vocab_list.unshift({
        word: currentWord,
        translation: currentTranslation,
        explanation: currentExplanation,
        context: currentContext.slice(0, 150),
        date: new Date().toLocaleDateString('ko-KR'),
    });

    saveSettingsDebounced();
    $popup.find('.vh-save-btn').hide();
    $popup.find('.vh-saved-badge').show();
    if ($('#vh-vocab-list').length) renderVocabList();
    if ($('#vh-modal-vocab-list').length && $vocabModal.is(':visible')) renderModalVocabList();
    toastr.success(`"${currentWord}" 단어장에 저장됨`);
}

// ── 단어장 렌더링 ──────────────────────────────────────────
function renderVocabList(filter = '') {
    const $list = $('#vh-vocab-list');
    if (!$list.length) return;

    const settings = getSettings();
    const list = filter
        ? settings.vocab_list.filter(v =>
            v.word.toLowerCase().includes(filter.toLowerCase()) ||
            (v.explanation || '').includes(filter))
        : settings.vocab_list;

    $('#vh-settings-count').text(`${settings.vocab_list.length}개 저장됨`);
    $list.empty();

    if (list.length === 0) {
        $list.append('<div class="vh-empty">저장된 단어가 없습니다.</div>');
        return;
    }

    list.forEach((item) => {
        const realIdx = settings.vocab_list.indexOf(item);
        const $item = $(`
            <div class="vh-vocab-item">
                <div class="vh-vocab-item-header">
                    <span class="vh-vocab-word">${escapeHtml(item.word)}</span>
                    <div class="vh-vocab-item-actions">
                        <span class="vh-vocab-date">${item.date}</span>
                        <button class="vh-delete-btn" data-index="${realIdx}" title="삭제">🗑</button>
                    </div>
                </div>
                <div class="vh-vocab-explanation">${escapeHtml(item.explanation || '').replace(/\n/g, '<br>')}</div>
                ${item.context ? `<div class="vh-vocab-context">"${escapeHtml(item.context)}"</div>` : ''}
            </div>
        `);
        $item.find('.vh-delete-btn').on('click', function (e) {
            e.stopPropagation();
            deleteVocab(parseInt($(this).data('index')));
        });
        $list.append($item);
    });
}

function deleteVocab(index) {
    const settings = getSettings();
    const word = settings.vocab_list[index]?.word;
    settings.vocab_list.splice(index, 1);
    saveSettingsDebounced();
    renderVocabList($('#vh-search-input').val()?.trim() || '');
    toastr.info(`"${word}" 삭제됨`);
}

function clearAllVocab() {
    if (!confirm('단어장을 전체 삭제할까요?')) return;
    const settings = getSettings();
    settings.vocab_list = [];
    saveSettingsDebounced();
    renderVocabList();
    toastr.warning('단어장이 초기화되었습니다.');
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

    // selectionchange: PC/모바일/터널 모두 커버
    document.addEventListener('selectionchange', handleSelectionChange);
    $(document).on('mouseup', onMouseUp);
    $(document).on('touchend', onTouchEnd);
    $(document).on('mousedown', function (e) {
        if (!$(e.target).closest('#vh-popup').length && $popup.is(':visible')) {
            const sel = window.getSelection();
            if (!sel || sel.toString().trim() === '') hidePopup();
        }
    });

    console.log('[VocabHelper] 확장 로드 완료');
});
