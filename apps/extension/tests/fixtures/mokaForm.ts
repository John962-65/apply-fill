// Structural fixture based on the public Moka application DOM; no applicant data or site scripts.
export function mokaInput(placeholder: string, extra = ''): string {
  return `<label class="sd-Input-container-test"><input type="text" maxlength="-1" placeholder="${placeholder}" ${extra}></label>`;
}

export function mokaSelect(placeholder = '请选择 / Please select', selected = '', extra = ''): string {
  return `<div class="sd-Dropdown-container-test"><label class="sd-Input-container-test sd-Select-container-test">
    <span class="sd-Input-display-value-test">${selected}</span><input type="text" maxlength="-1" placeholder="${placeholder}" ${extra}>
    <span class="sd-Input-addon-test"></span></label><span></span></div>`;
}

export function mokaField(title: string, control: string, required = false): string {
  return `<div class="apply-field-test"><div class="title-test"><span>${title}</span>${required ? '<span class="required-asterisk-test"></span>' : ''}</div>
    <div class="ctrl-test">${control}</div></div>`;
}

export function mokaRange(): string {
  return `<div class="month-range-select date_info wrapper-test"><label class="label-test"></label><span>
    <div class="item-test">${mokaSelect('年 / Year')}</div><div class="item-test">${mokaSelect('月 / Month')}</div></span>
    <span class="till-test">-</span><span><div class="item-test">${mokaSelect('年 / Year')}</div><div class="item-test">${mokaSelect('月 / Month')}</div></span></div>`;
}

export function mokaBlock(title: string, instances: string[], add = false): string {
  return `<div class="apply-block-test"><div class="blockTitle-test"><div><span class="text-test">${title}</span>${add ? '<button type="button">添加 / Add</button>' : ''}</div></div>
    ${instances.map((fields) => `<div class="apply-fields-test multi-test">${fields}</div>`).join('')}</div>`;
}
