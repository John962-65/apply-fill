<script setup lang="ts">
import { ref } from 'vue';

const name = ref('');
const email = ref('');
const intro = ref('');
const degree = ref('');
const gender = ref('');
const renderCount = ref(0);
</script>

<template>
  <form id="vue-form" :data-render-count="renderCount" style="max-width: 560px; line-height: 2">
    <h1>Vue 受控组件表单</h1>
    <div>
      <label for="v-name">姓名</label>
      <input id="v-name" type="text" data-testid="name" v-model="name" />
    </div>
    <div>
      <label for="v-email">邮箱</label>
      <input id="v-email" type="email" data-testid="email" v-model="email" />
    </div>
    <div>
      <label for="v-intro">个人简介</label>
      <textarea id="v-intro" data-testid="intro" v-model="intro"></textarea>
    </div>
    <div>
      <label for="v-degree">学历</label>
      <select id="v-degree" data-testid="degree" v-model="degree">
        <option value="">请选择</option>
        <option>大专</option>
        <option>本科</option>
        <option>硕士</option>
        <option>博士</option>
      </select>
    </div>
    <fieldset>
      <legend>性别</legend>
      <label>
        <input type="radio" name="v-gender" value="男" data-testid="gender-male" v-model="gender" /> 男
      </label>
      <label>
        <input type="radio" name="v-gender" value="女" data-testid="gender-female" v-model="gender" /> 女
      </label>
    </fieldset>
    <button type="button" data-testid="rerender" @click="renderCount += 1">重新渲染</button>
  </form>
</template>
