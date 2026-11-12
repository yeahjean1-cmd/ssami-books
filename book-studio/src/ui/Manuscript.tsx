import { useEffect, useLayoutEffect, useRef } from 'react';
import { derive } from '../engine/flow';
import { makeBlock } from '../model/factory';
import { STYLE_LABEL, STYLE_NAMES } from '../model/templates';
import type { Block, Project, StyleName } from '../model/types';
import {
  goToBlock, insertBlockAfter, insertStoryImage, mergeBlockUp, patchBlock, removeBlock, splitBlock, useStore,
} from '../store/store';
import { pickImageAsset } from './assets';

function autoSize(t: HTMLTextAreaElement) {
  t.style.height = '0';
  t.style.height = `${t.scrollHeight}px`;
}

/** 고른 글을 앞뒤 표시로 감싼다. 고른 글이 없으면 표시만 넣고 그 사이에 커서를 둔다. */
export function wrapSelection(block: Block, t: HTMLTextAreaElement, open: string, close: string) {
  const { selectionStart: a, selectionEnd: b, value } = t;
  patchBlock(block.id, { text: value.slice(0, a) + open + value.slice(a, b) + close + value.slice(b) });
  useStore.setState({ focus: { id: block.id, caret: (a === b ? a : b + close.length) + open.length } });
}

function BlockEditor({ block, caret }: { block: Block; caret: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = ref.current!;
    t.focus();
    t.setSelectionRange(caret, caret);
  }, [block.id, caret]);
  useLayoutEffect(() => autoSize(ref.current!), [block.text, block.style]);
  return (
    <textarea
      ref={ref}
      className="ms-text"
      value={block.text}
      rows={1}
      spellCheck={false}
      placeholder="글을 입력하세요"
      onChange={(e) => patchBlock(block.id, { text: e.target.value }, `block:${block.id}`)}
      onKeyDown={(e) => {
        e.stopPropagation();
        const t = e.currentTarget;
        if (e.nativeEvent.isComposing) return;
        const key = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (key === 'b' || key === 'i')) {
          // Ctrl+B 굵게, Ctrl+I 기울임: 고른 글을 표시로 감싼다
          e.preventDefault();
          wrapSelection(block, t, key === 'b' ? '**' : '*', key === 'b' ? '**' : '*');
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          // Enter: 새 문단 / Shift+Enter: 문단 안 줄바꿈
          e.preventDefault();
          splitBlock(block.id, t.selectionStart);
        } else if (e.key === 'Backspace' && t.selectionStart === 0 && t.selectionEnd === 0) {
          e.preventDefault();
          mergeBlockUp(block.id);
        } else if (e.key === 'Escape') t.blur();
      }}
    />
  );
}

/** 원고 보기: 책의 글을 문단 단위로 쓰고 고친다. 바꾸는 즉시 쪽이 다시 나뉜다. */
export function Manuscript({ project }: { project: Project }) {
  const focus = useStore((s) => s.focus);
  const story = project.story ?? [];
  const d = derive(project);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus) ref.current?.querySelector(`[data-block="${focus.id}"]`)?.scrollIntoView({ block: 'nearest' });
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
        <p className="hint ms-help">
          Enter로 문단을 나누고, 문단 맨 앞에서 Backspace로 앞 문단과 합쳐요. 왼쪽에서 문단 종류를 고르면 책 디자인이 자동으로 적용돼요.<br />
          글자 서식: <b>**굵게**</b>(Ctrl+B) · <i>*기울임*</i>(Ctrl+I) · <u>__밑줄__</u> · <s>~~취소선~~</s> · 각주는 <code>[^각주 내용]</code>을 넣은 자리에 번호가 붙고, 내용은 그 쪽 아래에 놓여요.
        </p>
        {story.map((b) => {
          const active = focus?.id === b.id;
          const page = pageOf(b.id);
          return (
            <div key={b.id} className={`ms-row style-${b.style}${active ? ' on' : ''}`} data-block={b.id}>
              <div className="ms-side">
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
                  <BlockEditor block={b} caret={focus!.caret} />
                ) : (
                  <div
                    className="ms-text" tabIndex={0}
                    onClick={() => useStore.setState({ focus: { id: b.id, caret: b.text.length } })}
                    onFocus={() => useStore.setState({ focus: { id: b.id, caret: b.text.length } })}
                  >
                    {b.text || <span className="ms-empty">빈 문단</span>}
                  </div>
                )}
              </div>
              <div className="ms-tools">
                {page && <button className="btn ghost small" onClick={() => goToBlock(b.id)} title="이 문단이 놓인 쪽 보기">{page}쪽</button>}
                {(active || b.assetId) && (
                  <>
                    {active && <button className="btn ghost small" data-act="footnote" title="커서 자리에 각주를 넣어요" onMouseDown={(e) => {
                      e.preventDefault();
                      const t = document.querySelector<HTMLTextAreaElement>('textarea.ms-text');
                      if (t) wrapSelection(b, t, '[^', ']');
                    }}>＋각주</button>}
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
