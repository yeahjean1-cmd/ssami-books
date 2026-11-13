import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { derive } from '../engine/flow';
import { parseMarkup } from '../engine/layout';
import { makeBlock } from '../model/factory';
import { STYLE_LABEL, STYLE_NAMES } from '../model/templates';
import type { Block, Project, StyleName } from '../model/types';
import {
  goToBlock, insertBlockAfter, insertStoryImage, mergeBlockUp, patchBlock, removeBlock, splitBlockTexts, useStore,
} from '../store/store';
import { pickImageAsset } from './assets';

// 문단의 글은 간단한 표시(**굵게**, *기울임*, __밑줄__, ~~취소선~~, [^각주])가 섞인 텍스트로 저장한다.
// 화면에서는 표시 대신 서식이 적용된 모습으로 보여 주고, 고치면 다시 표시가 섞인 텍스트로 되돌린다.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TAGS: [number, string][] = [[1, 'b'], [2, 'i'], [8, 'u'], [16, 's']];

/** 저장된 글 → 편집 화면의 HTML */
function toHtml(text: string, last = true): string {
  const p = parseMarkup(text);
  let html = '';
  let buf = '';
  let flag = 0;
  const push = () => {
    if (!buf) return;
    const tags = TAGS.filter(([bit]) => flag & bit).map(([, t]) => t);
    html += tags.map((t) => `<${t}>`).join('') + esc(buf).replace(/\n/g, '<br>') + tags.reverse().map((t) => `</${t}>`).join('');
    buf = '';
  };
  p.chars.forEach((ch, i) => {
    if (p.fn[i] !== undefined) {
      push();
      const note = esc(p.notes[p.fn[i]!]);
      html += `<sup class="fn-chip" contenteditable="false" data-note="${note}" title="${note}">각주</sup>`;
      return;
    }
    const f = p.flags[i] ?? 0;
    if (f !== flag) push();
    flag = f;
    buf += ch;
  });
  push();
  // 줄바꿈으로 끝나면 빈 줄이 보이도록 줄바꿈을 하나 더 둔다(되돌릴 때 다시 뺀다)
  return last && text.endsWith('\n') ? `${html}<br>` : html;
}

const WRAP: Record<string, string> = { B: '**', STRONG: '**', I: '*', EM: '*', U: '__', S: '~~', STRIKE: '~~', DEL: '~~' };

/** 편집 화면의 내용 → 저장할 글 */
function serialize(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
  const inner = () => Array.from(n.childNodes).map(serialize).join('');
  if (!(n instanceof HTMLElement)) return inner();
  if (n.classList.contains('fn-chip')) return `[^${(n.dataset.note ?? '').replace(/[[\]\n]/g, ' ').trim()}]`;
  if (n.tagName === 'BR') return '\n';
  const mark = WRAP[n.tagName];
  const text = inner();
  if (!mark) return text;
  // 서식의 양 끝 공백은 밖으로 빼야 표시가 올바르게 읽힌다
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function readEditor(el: HTMLElement): string {
  const t = serialize(el);
  return el.lastChild?.nodeName === 'BR' && t.endsWith('\n') ? t.slice(0, -1) : t;
}

/** 쓰지 않는 문단을 서식이 적용된 모습으로 보여 준다. */
export function renderMarkup(text: string) {
  return <span dangerouslySetInnerHTML={{ __html: toHtml(text).replace(/ contenteditable="false"/g, '') }} />;
}

const FORMATS: [string, string, string][] = [['굵게', 'bold', 'Ctrl+B'], ['기울임', 'italic', 'Ctrl+I'], ['밑줄', 'underline', 'Ctrl+U'], ['취소선', 'strikeThrough', '']];

/** 글을 쓰는 문단: 서식이 바로 적용되어 보이는 편집 칸 */
function BlockEditor({ block, caret }: { block: Block; caret: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastText = useRef<string | null>(null);
  const [chip, setChip] = useState<HTMLElement | null>(null);
  const [note, setNote] = useState('');
  const noteInput = useRef<HTMLInputElement>(null);

  // 처음 열 때와, 실행 취소처럼 밖에서 글이 바뀌었을 때만 화면을 다시 채운다(쓰는 중에는 커서를 건드리지 않는다)
  useLayoutEffect(() => {
    const el = ref.current!;
    if (lastText.current === block.text) return;
    const first = lastText.current === null;
    const c = first ? Math.max(0, Math.min(block.text.length, caret)) : block.text.length;
    el.innerHTML = `${toHtml(block.text.slice(0, c), false)}<span data-caret></span>${toHtml(block.text.slice(c))}`;
    const mark = el.querySelector('[data-caret]')!;
    const range = document.createRange();
    range.setStartBefore(mark);
    range.collapse(true);
    mark.remove();
    el.normalize();
    el.focus();
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    lastText.current = block.text;
    setChip(null);
  }, [block.id, block.text, caret]);

  const commit = () => {
    const text = readEditor(ref.current!);
    lastText.current = text;
    patchBlock(block.id, { text }, `block:${block.id}`);
  };

  /** 커서 앞뒤의 글을 각각 저장 형태로 얻는다(서식 한가운데에서 나눠도 양쪽이 온전하다). */
  const around = () => {
    const el = ref.current!;
    const sel = getSelection();
    if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(r.startContainer, r.startOffset);
    const after = document.createRange();
    after.selectNodeContents(el);
    after.setStart(r.endContainer, r.endOffset);
    const b = serialize(before.cloneContents());
    let a = serialize(after.cloneContents());
    if (el.lastChild?.nodeName === 'BR' && a.endsWith('\n')) a = a.slice(0, -1);
    return { before: b, after: a, collapsed: r.collapsed };
  };

  const format = (cmd: string) => {
    ref.current!.focus();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(cmd);
    commit();
  };

  const addNote = () => {
    const el = ref.current!;
    el.focus();
    const sel = getSelection()!;
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return;
    const r = sel.getRangeAt(0);
    r.collapse(false);
    const sup = document.createElement('sup');
    sup.className = 'fn-chip';
    sup.contentEditable = 'false';
    sup.dataset.note = '';
    sup.textContent = '각주';
    r.insertNode(sup);
    r.setStartAfter(sup);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    commit();
    setChip(sup);
    setNote('');
    setTimeout(() => noteInput.current?.focus());
  };

  return (
    <>
      <div className="format-bar" id="format-bar">
        {FORMATS.map(([name, cmd, key]) => (
          <button key={cmd} data-format={name} title={key ? `${name} (${key})` : name} onMouseDown={(e) => { e.preventDefault(); format(cmd); }}>{name}</button>
        ))}
        <button data-format="각주" title="커서 자리에 각주를 넣어요" onMouseDown={(e) => { e.preventDefault(); addNote(); }}>각주</button>
        {chip && (
          <input
            ref={noteInput} id="note-input" className="note-input" value={note} placeholder="각주 내용을 적어 주세요"
            onChange={(e) => {
              setNote(e.target.value);
              chip.dataset.note = e.target.value;
              chip.title = e.target.value;
              commit();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setChip(null); ref.current!.focus(); }
            }}
          />
        )}
      </div>
      <div
        ref={ref}
        className="ms-text ms-edit"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        data-placeholder="글을 입력하세요"
        onInput={commit}
        onClick={(e) => {
          const c = (e.target as HTMLElement).closest<HTMLElement>('.fn-chip');
          setChip(c);
          if (c) setNote(c.dataset.note ?? '');
        }}
        onPaste={(e) => {
          // 다른 프로그램의 서식은 버리고 글만 붙인다
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            // Enter: 새 문단 / Shift+Enter: 문단 안 줄바꿈
            e.preventDefault();
            const a = around();
            if (a) splitBlockTexts(block.id, a.before, a.after);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            document.execCommand('insertLineBreak');
            commit();
          } else if (e.key === 'Backspace') {
            const a = around();
            if (a?.collapsed && a.before === '') {
              e.preventDefault();
              mergeBlockUp(block.id);
            }
          } else if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
        }}
      />
    </>
  );
}

/** 원고 보기: 책의 글을 문단 단위로 쓰고 고친다. 바꾸는 즉시 쪽이 다시 나뉜다. */
export function Manuscript({ project }: { project: Project }) {
  const focus = useStore((s) => s.focus);
  const story = project.story ?? [];
  const d = derive(project);
  const ref = useRef<HTMLDivElement>(null);
  /** 접어 둔 장(장 제목 문단의 id) */
  const [folded, setFolded] = useState<Set<string>>(new Set());

  // 문단마다 속한 장을 구한다
  const chapterOf = new Map<string, string | null>();
  let current: string | null = null;
  for (const b of story) {
    if (b.style === 'chapter' && !b.assetId) current = b.id;
    chapterOf.set(b.id, current);
  }
  const chapters = story.filter((b) => b.style === 'chapter' && !b.assetId);
  const toggle = (id: string) => setFolded((f) => {
    const n = new Set(f);
    if (!n.delete(id)) n.add(id);
    return n;
  });

  useEffect(() => {
    if (!focus) return;
    // 접힌 장 안의 문단으로 이동하면 그 장을 편다
    const ch = chapterOf.get(focus.id);
    if (ch && ch !== focus.id && folded.has(ch)) setFolded((f) => new Set([...f].filter((x) => x !== ch)));
    ref.current?.querySelector(`[data-block="${focus.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus?.id]);

  const pageOf = (id: string) => {
    const fi = d.pagination?.blockPage.get(id);
    const page = fi === undefined ? -1 : d.flowIndex.indexOf(fi);
    return page >= 0 ? page + 1 : null;
  };
  const addImage = async (afterId: string | null) => {
    const asset = await pickImageAsset();
    if (asset) insertStoryImage(afterId, asset);
  };

  return (
    <div className="manuscript" ref={ref} id="manuscript">
      <div className="ms-sheet">
        <div className="ms-help">
          <p className="hint">
            Enter로 문단을 나누고, 문단 맨 앞에서 Backspace로 앞 문단과 합쳐요. 문단을 누르면 굵게·기울임·밑줄·취소선·각주 버튼이 나타나고, 적용한 모습이 바로 보여요.
          </p>
          {chapters.length > 0 && (
            <div className="row">
              <button className="btn small" id="fold-all" onClick={() => { setFolded(new Set(chapters.map((c) => c.id))); useStore.setState({ focus: null }); }}>모두 접기</button>
              <button className="btn small" id="unfold-all" onClick={() => setFolded(new Set())}>모두 펴기</button>
            </div>
          )}
        </div>
        {story.map((b) => {
          const ch = chapterOf.get(b.id);
          const isChapter = ch === b.id;
          const isFolded = !!ch && folded.has(ch);
          if (isFolded && !isChapter) return null;
          const active = focus?.id === b.id;
          const page = pageOf(b.id);
          const inside = isChapter && isFolded ? story.filter((x) => chapterOf.get(x.id) === b.id && x.id !== b.id) : [];
          return (
            <div key={b.id} className={`ms-row style-${b.style}${active ? ' on' : ''}`} data-block={b.id}>
              <div className="ms-side">
                {isChapter && (
                  <button className="ms-fold" aria-expanded={!isFolded} title={isFolded ? '이 장 펴기' : '이 장 접기'} onClick={() => toggle(b.id)}>{isFolded ? '▸' : '▾'}</button>
                )}
                {b.assetId ? <span className="ms-kind">이미지</span> : (
                  <select
                    value={b.style} aria-label="문단 종류"
                    onChange={(e) => patchBlock(b.id, { style: e.target.value as StyleName })}
                  >
                    {STYLE_NAMES.map((n) => <option key={n} value={n}>{STYLE_LABEL[n]}</option>)}
                  </select>
                )}
              </div>
              <div className="ms-main">
                {b.assetId ? (
                  project.assets[b.assetId] && <img src={project.assets[b.assetId].dataUrl} alt={project.assets[b.assetId].name} />
                ) : active ? (
                  <BlockEditor key={b.id} block={b} caret={focus!.caret} />
                ) : (
                  <div
                    className="ms-text" tabIndex={0}
                    onClick={() => useStore.setState({ focus: { id: b.id, caret: b.text.length } })}
                    onFocus={() => useStore.setState({ focus: { id: b.id, caret: b.text.length } })}
                  >
                    {b.text ? renderMarkup(b.text) : <span className="ms-empty">빈 문단</span>}
                  </div>
                )}
                {isChapter && isFolded && (
                  <button className="ms-folded" onClick={() => toggle(b.id)}>
                    문단 {inside.length}개 · {inside.reduce((n, x) => n + x.text.length, 0).toLocaleString('ko-KR')}자 접힘 — 눌러서 펴기
                  </button>
                )}
              </div>
              <div className="ms-tools">
                {page && <button className="btn ghost small" onClick={() => goToBlock(b.id)} title="이 문단이 놓인 쪽 보기">{page}쪽</button>}
                {(active || b.assetId) && (
                  <>
                    <button className="btn ghost small" onClick={() => addImage(b.id)} title="이 문단 뒤에 이미지를 넣어요">＋이미지</button>
                    <button className="btn ghost small" onClick={() => removeBlock(b.id)} aria-label="문단 삭제">삭제</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div className="ms-foot">
          <button className="btn" id="ms-add" onClick={() => insertBlockAfter(null, makeBlock('body', ''))}>＋ 문단</button>
          <button className="btn" onClick={() => insertBlockAfter(null, makeBlock('chapter', ''))}>＋ 장 제목</button>
          <button className="btn" onClick={() => addImage(null)}>＋ 이미지</button>
        </div>
      </div>
    </div>
  );
}
