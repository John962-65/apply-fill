import { describe, expect, it } from 'vitest';

import { findInstanceContainers, findAddControl, scanRepeatableSections } from '@/perceptor/SectionScanner';
import type { ScannedSection } from '@/perceptor/SectionScanner';

function setupRepeater(): void {
  document.body.innerHTML = `
    <form>
      <section id="projects">
        <h2>项目经历</h2>
        <div class="list">
          <div class="item">
            <label>项目名称<input name="projectName" /></label>
            <label>开始时间<input name="projectStart" /></label>
            <label>项目描述<textarea name="projectDesc"></textarea></label>
          </div>
          <div class="item">
            <label>项目名称<input name="projectName" /></label>
            <label>开始时间<input name="projectStart" /></label>
            <label>项目描述<textarea name="projectDesc"></textarea></label>
          </div>
        </div>
        <button type="button">添加项目</button>
      </section>
      <section id="basic">
        <h2>个人信息</h2>
        <label>姓名<input name="fullName" /></label>
      </section>
    </form>`;
}

function sectionOf(sections: ScannedSection[], type: string): ScannedSection {
  const section = sections.find((item) => item.sectionType === type);
  if (section === undefined) {
    throw new Error(`section not found: ${type}`);
  }
  return section;
}

describe('scanRepeatableSections', () => {
  it('识别重复区块、容器与添加按钮', () => {
    setupRepeater();
    const sections = scanRepeatableSections(document);
    const projects = sectionOf(sections, 'project');
    expect(projects.headingText).toBe('项目经历');
    expect(projects.containers).toHaveLength(2);
    expect(projects.containers[0]?.classList.contains('item')).toBe(true);
    expect(projects.addControl?.textContent).toBe('添加项目');
  });

  it('无重复结构时不产生区块', () => {
    setupRepeater();
    const sections = scanRepeatableSections(document);
    expect(sections.some((section) => section.sectionType === 'basic')).toBe(false);
  });

  it('单个实例的区块仍产生一个容器', () => {
    document.body.innerHTML = `
      <section>
        <h2>教育经历</h2>
        <div class="item">
          <label>学校名称<input name="school" /></label>
          <label>学历<select name="degree"><option>本科</option></select></label>
        </div>
      </section>`;
    const sections = scanRepeatableSections(document);
    const education = sectionOf(sections, 'education');
    expect(education.containers).toHaveLength(1);
    expect(education.addControl).toBeNull();
  });

  it('字段行不包装实例时判为单一容器', () => {
    document.body.innerHTML = `
      <section>
        <h2>教育经历</h2>
        <div>
          <label>学校名称<input name="school" /></label>
          <label>学历<select name="degree"><option>本科</option></select></label>
          <label>专业<input name="major" /></label>
        </div>
      </section>`;
    const containers = findInstanceContainers(
      document.querySelector('section') as HTMLElement,
    );
    expect(containers).toHaveLength(1);
    expect(containers[0]?.querySelectorAll('input, select, textarea')).toHaveLength(3);
  });

  it('优先使用 data-applyfill-add 标记的按钮', () => {
    document.body.innerHTML = `
      <section>
        <h2>项目经历</h2>
        <div class="list">
          <div class="item"><label>项目名称<input name="projectName" /></label></div>
          <div class="item"><label>项目名称<input name="projectName" /></label></div>
        </div>
        <button type="button">添加项目</button>
        <a href="#" data-applyfill-add>再加一段</a>
      </section>`;
    const sections = scanRepeatableSections(document);
    const projects = sectionOf(sections, 'project');
    expect(projects.addControl?.tagName.toLowerCase()).toBe('a');
  });

  it('按钮位于容器内时不作为添加控件', () => {
    document.body.innerHTML = `
      <section>
        <h2>项目经历</h2>
        <div class="list">
          <div class="item">
            <label>项目名称<input name="projectName" /></label>
            <button type="button">添加经历</button>
          </div>
          <div class="item">
            <label>项目名称<input name="projectName" /></label>
            <button type="button">添加经历</button>
          </div>
        </div>
      </section>`;
    const scope = document.querySelector('section') as HTMLElement;
    const containers = findInstanceContainers(scope);
    expect(findAddControl(scope, containers)).toBeNull();
  });
});
