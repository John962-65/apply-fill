import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h, ref } from 'vue';

const mode = new URLSearchParams(location.search).get('mode') ?? 'vanilla';
const host = document.getElementById('root')!;
document.head.insertAdjacentHTML('beforeend', '<style>body{font:16px system-ui;padding:32px}input,button{padding:10px;margin:4px}#choices{padding:15px;background:#eee;max-width:380px}output{display:block}</style>');

function ReactChoice() {
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState('');
  const [pending, setPending] = useState('');
  const [accepted, setAccepted] = useState('');
  const [generation, setGeneration] = useState(0);
  const [submissions, setSubmissions] = useState(0);
  const focus = mode === 'react-focus';
  const confirmation = mode === 'confirmation' || mode === 'takeover' || mode === 'stale' || mode === 'unsafe';
  const choose = (value: string) => {
    setDisplay(value === 'M' ? '男' : '女'); setPending(value);
    if (!confirmation) { setAccepted(value); setOpen(false); }
    if (mode === 'redraw') setGeneration((current) => current + 1);
  };
  return <main><h1>申请资料</h1><form onSubmit={(event) => { event.preventDefault(); setSubmissions((current) => current + 1); }}>
    <div data-combobox-root><label htmlFor="choice">性别</label>
      <input id="choice" role="combobox" readOnly required aria-controls="choices" aria-expanded={open}
        value={display} data-testid="choice" onFocus={() => { if (focus) setOpen(true); }}
        onClick={() => { if (!focus) setOpen(true); }} />
      <input type="hidden" value={accepted} readOnly />
    </div>
    {open ? <div id="choices" key={generation}>
      {['M', 'F'].map((value) => <button type="button" key={value} data-value={value} aria-pressed={pending === value}
        data-testid={`candidate-${value}`} onClick={() => choose(value)}>{value === 'M' ? '男' : '女'}</button>)}
      {confirmation ? <button type="button" data-testid="adopt" onClick={() => { setAccepted(pending); setOpen(false); }}>采用此项</button> : null}
      {mode === 'unsafe' ? <button type="submit" data-testid="danger">提交申请</button> : null}
    </div> : null}
  </form><output data-testid="accepted">{accepted}</output><output data-testid="submissions">{submissions}</output>
    <output data-testid="generation">{generation}</output></main>;
}

function mountVue() {
  createApp({ setup() {
    const open = ref(false); const active = ref(''); const accepted = ref(''); const display = ref('');
    return () => h('main', [h('h1', '申请资料'), h('div', { 'data-combobox-root': '' }, [
      h('label', { for: 'choice' }, '性别'), h('input', { id: 'choice', role: 'combobox', readonly: true, required: true,
        'data-testid': 'choice', 'aria-controls': 'choices', 'aria-expanded': open.value,
        'aria-activedescendant': active.value ? `item-${active.value}` : undefined, value: display.value,
        onKeydown: (event: KeyboardEvent) => {
          if (event.key === 'ArrowDown') open.value = true;
          if (event.key === 'Enter' && active.value) { accepted.value = active.value; open.value = false; }
        } }), h('input', { type: 'hidden', value: accepted.value }),
    ]), open.value ? h('div', { id: 'choices' }, ['M', 'F'].map((value) => h('div', {
      id: `item-${value}`, role: 'option', tabindex: -1, 'data-value': value, 'aria-selected': active.value === value,
      'data-testid': `candidate-${value}`, onClick: () => { active.value = value; display.value = value === 'M' ? '男' : '女'; },
    }, value === 'M' ? '男' : '女'))) : null, h('output', { 'data-testid': 'accepted' }, accepted.value),
    h('output', { 'data-testid': 'submissions' }, '0')]);
  } }).mount(host);
}

function mountVanilla() {
  host.innerHTML = '<main><h1>申请资料</h1><div data-combobox-root><label for="choice">性别</label>' +
    '<input id="choice" role="combobox" readonly required aria-controls="choices" aria-expanded="false" data-testid="choice">' +
    '<input type="hidden" id="value"></div><div id="choices" hidden></div><output data-testid="accepted"></output>' +
    '<output data-testid="submissions">0</output><output data-testid="clicks">0</output></main>';
  const target = document.getElementById('choice') as HTMLInputElement;
  const value = document.getElementById('value') as HTMLInputElement;
  const popup = document.getElementById('choices')!;
  let clicks = 0;
  target.onclick = () => {
    popup.hidden = false; target.setAttribute('aria-expanded', 'true'); popup.replaceChildren();
    for (const [index, text] of ['男', mode === 'duplicate' ? '男' : '女'].entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.dataset.value = index === 0 ? 'M' : 'F'; button.dataset.testid = `candidate-${index === 0 ? 'M' : 'F'}`;
      button.onclick = (event) => {
        document.querySelector('[data-testid=clicks]')!.textContent = String(++clicks);
        if (mode === 'trusted' && !event.isTrusted) return;
        target.value = text;
        if (mode !== 'no-business') { value.value = button.dataset.value!; document.querySelector('[data-testid=accepted]')!.textContent = value.value; }
        popup.hidden = true; target.setAttribute('aria-expanded', 'false');
      };
      popup.append(button);
    }
  };
}

if (mode === 'vue-keyboard') mountVue();
else if (['react-focus', 'confirmation', 'takeover', 'stale', 'redraw', 'unsafe'].includes(mode)) createRoot(host).render(<ReactChoice />);
else mountVanilla();
