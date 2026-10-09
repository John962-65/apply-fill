import Vue from 'vue/dist/vue.esm.js';
import {DatePicker as ElDatePicker, Select as ElSelect, Option as ElOption} from 'element-ui';
import {DatePicker as IvuDatePicker, Select as IvuSelect, Option as IvuOption} from 'view-design';

new Vue({
  el:'#vue-fixture',
  components:{ElDatePicker,ElSelect,ElOption,IvuDatePicker,IvuSelect,IOption:IvuOption},
  data:()=>({values:{},initialized:false}),
  methods:{save(id,value){window.values[id]=value instanceof Date ? [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-') : value;}}
});
window.vueReady=true;
window.mountDisabledMonth=()=>{
  const host=document.createElement('div');host.className='el-form-item';host.dataset.test='element-disabled';
  host.innerHTML='<div class="el-form-item__label">获奖时间</div><div id="disabled-vue"></div>';document.body.append(host);
  new Vue({el:'#disabled-vue',data:()=>({value:null}),render:h=>h(ElDatePicker,{props:{value:null,type:'month',placeholder:'YYYY-MM',pickerOptions:{disabledDate:d=>d.getFullYear()===2022}}})});
  host.querySelector('input').id='element-disabled';
};
window.mountConfirmMonth=()=>{
  const host=document.createElement('div');host.className='ivu-form-item';host.dataset.test='iview-confirm';
  host.innerHTML='<div class="ivu-form-item-label">获奖时间</div><div id="confirm-vue"></div>';document.body.append(host);
  new Vue({el:'#confirm-vue',data:()=>({value:null}),render:h=>h(IvuDatePicker,{props:{value:null,type:'month',format:'yyyy-MM',confirm:true,transfer:true,placeholder:'YYYY-MM'},on:{'on-ok':()=>{window.confirmOK=true;},'on-change':value=>{window.values['iview-confirm']=value;}}})});
  host.querySelector('input').id='iview-confirm';
};
