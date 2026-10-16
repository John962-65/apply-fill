<script setup lang="ts">
import { reactive, ref } from 'vue';

interface EducationItem {
  uid: number;
  school: string;
  degree: string;
  major: string;
}

interface ProjectItem {
  uid: number;
  name: string;
  role: string;
  desc: string;
}

const DEGREE_OPTIONS = ['', '大专', '本科', '硕士', '博士'];

const education = reactive<EducationItem[]>([{ uid: 1, school: '', degree: '', major: '' }]);
const projects = reactive<ProjectItem[]>([{ uid: 1, name: '', role: '', desc: '' }]);
const uidCounter = ref(100);

function nextUid(): number {
  uidCounter.value += 1;
  return uidCounter.value;
}

function addEducation(): void {
  education.push({ uid: nextUid(), school: '', degree: '', major: '' });
}

function addProject(): void {
  projects.push({ uid: nextUid(), name: '', role: '', desc: '' });
}

function removeMiddleProject(): void {
  if (projects.length > 1) {
    projects.splice(1, 1);
  }
}
</script>

<template>
  <form id="repeater-form" style="max-width: 640px; line-height: 2">
    <h1>Vue 重复经历表单</h1>

    <section id="education-section">
      <h2>教育经历</h2>
      <div class="edu-list">
        <div v-for="item in education" :key="item.uid" class="edu-item" :data-testid="`edu-item-${item.uid}`">
          <div>
            <label :for="`edu-school-${item.uid}`">学校名称</label>
            <input :id="`edu-school-${item.uid}`" v-model="item.school" name="school" :data-testid="`edu-school-${item.uid}`" />
          </div>
          <div>
            <label :for="`edu-degree-${item.uid}`">学历</label>
            <select :id="`edu-degree-${item.uid}`" v-model="item.degree" name="degree" :data-testid="`edu-degree-${item.uid}`">
              <option v-for="option in DEGREE_OPTIONS" :key="option" :value="option">{{ option === '' ? '请选择' : option }}</option>
            </select>
          </div>
          <div>
            <label :for="`edu-major-${item.uid}`">专业</label>
            <input :id="`edu-major-${item.uid}`" v-model="item.major" name="major" :data-testid="`edu-major-${item.uid}`" />
          </div>
        </div>
      </div>
      <button type="button" data-testid="add-education" @click="addEducation">添加教育</button>
    </section>

    <section id="project-section">
      <h2>项目经历</h2>
      <div class="project-list">
        <div v-for="item in projects" :key="item.uid" class="project-item" :data-testid="`project-item-${item.uid}`">
          <div>
            <label :for="`project-name-${item.uid}`">项目名称</label>
            <input :id="`project-name-${item.uid}`" v-model="item.name" name="projectName" :data-testid="`project-name-${item.uid}`" />
          </div>
          <div>
            <label :for="`project-role-${item.uid}`">担任角色</label>
            <input :id="`project-role-${item.uid}`" v-model="item.role" name="projectRole" :data-testid="`project-role-${item.uid}`" />
          </div>
          <div>
            <label :for="`project-desc-${item.uid}`">项目描述</label>
            <textarea :id="`project-desc-${item.uid}`" v-model="item.desc" name="projectDesc" :data-testid="`project-desc-${item.uid}`"></textarea>
          </div>
        </div>
      </div>
      <button type="button" data-testid="add-project" @click="addProject">添加项目</button>
      <button type="button" data-testid="remove-middle-project" @click="removeMiddleProject">删除中间项目</button>
    </section>
  </form>
</template>
