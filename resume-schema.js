/* Application field catalogue. Facts remain in ResumeProTree; presets only add empty slots.
 * Evidence and limits: docs/campus-resume-schema.md. No platform's fields are mandatory here. */
(function(root) {
  const field=(label,aliases=[],hint='',core=true)=>({label,aliases,hint,core});
  const dateHint='按已知精度填写：2024、2024-09 或 2024-09-01；不要补造月份或日期';
  const start=()=>field('开始时间',['起始时间','开始日期'],dateHint);
  const end=()=>field('结束时间',['终止时间','结束日期'],dateHint+'；仍在进行可填“至今”');
  const section=(id,name,aliases,repeat,fields,note='',common=true)=>({id,name,aliases,repeat,fields,note,common});
  const sections=[
    section('basic','基本信息',['个人信息','个人资料'],false,[
      field('姓名',['中文姓名']),field('手机号',['手机号码','联系电话']),field('邮箱',['电子邮箱','电子邮件']),
      field('出生日期',['生日'],dateHint),field('性别'),field('现居住地',['现居地','当前所在地'],'与籍贯、户籍所在地分别保存'),
      field('国籍',[],'',false),field('籍贯',[],'不要用现居住地代替',false),field('户籍所在地',['户口所在地'],'',false),
      field('民族',[],'',false),field('政治面貌',[],'',false),field('通讯地址',['联系地址'],'',false),
      field('证件类型',[],'按实际持有的证件填写',false),field('证件号码',['身份证号码','身份证号'],'与证件类型对应；可在申请时补充',false)
    ]),
    section('intention','求职意向',['求职信息'],false,[
      field('意向岗位',['期望职位','求职岗位']),field('意向城市',['期望工作地点','期望城市','期望工作城市']),
      field('毕业届别',['应届届别'],'例如 2027 届，请本人确认'),field('可到岗时间',['到岗时间'],dateHint),
      field('期望薪资',['期望月薪(税前)'],'注明月薪/年薪、税前/税后；无确定意向可留空',false),field('每周实习天数',[],'',false),field('可实习时长',[],'',false),
      field('意向行业',['期望从事行业'],'以本人明确意向为准，不从专业或项目推断',false),field('意向职业',['期望从事职业'],'',false)
    ],'保存通用意向。内推码、岗位志愿顺序、调剂意愿等按具体申请确认。'),
    section('education','教育经历',['教育背景','教育信息'],true,[
      field('学校名称',['学校','院校','院校名称','毕业院校']),field('学历',[],'学士可依据本条学位转换为本科；保留原文和推导依据'),field('学位',[],'保留原文，如工学学士；与学历分别保存'),field('专业',['专业名称','所学专业']),
      field('入学时间',['开始时间','入学日期'],dateHint),field('毕业时间',['结束时间','毕业日期'],dateHint+'；预计毕业时间请在备注中说明'),
      field('学院',['院系'],'',false),field('学习形式',['教育类型'],'如全日制，以实际情况为准',false),
      field('学校所在国家',[],'不要根据校名推断',false),field('学校所在城市',[],'',false),
      field('平均绩点',['GPA'],'保存原始分值，例如 3.6；满分另填',false),field('绩点满分',[],'例如 4 或 5',false),
      field('专业排名',[],'保留原文，例如 8/120 或前 10%，不要互相估算',false),field('主修课程',['主要课程'],'',false),
      field('研究方向',[],'',false),field('导师姓名',[],'',false),field('毕业论文题目',[],'',false),field('备注',[],'',false)
    ],'本科、硕士分别建记录，即使学校相同；有平台要求时再补高中。学历和学位分开。'),
    section('internship','实习经历',['实习经验'],true,[
      field('公司名称',['公司','单位名称','实习单位']),field('职位名称',['职位','岗位','实习岗位']),start(),end(),field('工作职责',['实习内容','职责描述','描述']),
      field('工作成果',[],'',false),field('部门',['所属部门'],'',false),field('工作地点',[],'',false)
    ]),
    section('work','工作经历',['工作经验','工作履历'],true,[
      field('公司名称',['公司','单位名称']),field('职位名称',['职位','岗位']),start(),end(),field('工作职责',['工作内容','职责描述','描述']),
      field('工作成果',[],'',false),field('部门',['所属部门'],'',false),field('工作地点',[],'',false),field('离职原因',[],'',false)
    ],'没有正式工作经历可不添加记录；实习保存在实习经历。',false),
    section('project','项目经历',['项目经验'],true,[
      field('项目名称'),field('项目角色',['担任角色','担任职务']),start(),end(),field('项目描述',['内容概述','项目简介','描述']),
      field('主要职责',['主要工作','项目职责']),field('项目成果',[],'保留有依据的指标',false),field('项目链接',['链接'],'',false),field('技术栈',[],'',false)
    ],'项目整体介绍、本人职责、成果分别保存。'),
    section('research','科研经历',['科研项目','科研经验'],true,[
      field('项目名称',['课题名称']),field('项目角色',['担任角色']),start(),end(),field('项目描述',['内容概述','研究内容','描述']),
      field('主要职责',['主要工作']),field('项目成果',[],'',false),field('项目链接',['链接'],'',false)
    ],'科研项目单独保存，按招聘页面板块匹配。',false),
    section('campus','校园经历',['校园实践','在校职务','校内职务','在校经历','社团经历','学生工作','社会实践'],true,[
      field('组织名称',['社团名称','学生组织']),field('担任职务',['职位','职务']),start(),end(),field('经历描述',['描述','工作内容']),field('成果',[],'',false)
    ],'每段任职或活动建立一条记录。'),
    section('awards','获奖经历',['获奖','奖励','奖项','荣誉奖励','荣誉奖项'],true,[
      field('获奖名称',['奖项名称','奖励名称']),field('获奖时间',['获奖日期','颁奖时间'],dateHint),
      field('获奖描述',['描述','获奖说明']),field('奖项级别',['获奖级别'],'如校级、省级、国家级；不要与一等奖等次混淆',false),
      field('获奖等级',['奖项等级'],'如一等奖、二等奖',false),field('颁奖单位',['颁发机构'],'',false)
    ],'一个奖项一条记录。名称、时间、描述必须属于同一个奖项。'),
    section('language','语言能力',['外语能力','语言技能'],true,[
      field('语言',['语种','语言类型']),field('掌握程度',['精通程度','熟练程度'],'综合能力；不要从考试等级或分数推断'),field('听说能力',['听说'],'只记录明确的听说水平',false),field('读写能力',['读写'],'阅读和写作均有依据时填写',false),
      field('阅读能力',[],'阅读能力不能代替写作能力',false),field('写作能力',[],'只记录明确的写作水平',false)
    ],'每种语言一条记录。考试分数不自动换算成精通程度。'),
    section('exam','语言考试',['外语考试','语言成绩'],true,[
      field('考试名称',['考试类型']),field('考试成绩',['成绩','分数']),field('考试时间',['考试日期'],dateHint),field('证书编号',[],'',false)
    ],'四级、六级、雅思、托福分别保存考试名称和原始分数；与语言能力分开。'),
    section('skills','专业技能',['技能','技能特长'],true,[
      field('技能名称'),field('熟练程度',['掌握程度']),field('技能描述',['描述']),field('使用年限',[],'不从项目日期推算',false)
    ]),
    section('certificates','资格证书',['证书','职业资格','技能证书'],true,[
      field('证书名称'),field('取得时间',['获得时间','发证时间'],dateHint),field('颁发机构',['发证机关']),
      field('证书等级',[],'',false),field('证书编号',[],'',false),field('有效期至',[],dateHint,false)
    ],'资格证书与比赛奖项分别保存。',false),
    section('papers','论文',['论文成果','学术论文'],true,[
      field('论文标题',['标题','论文名称']),field('期刊或会议',['期刊','会议']),field('发表状态',[],'在投、录用、发表分别保存'),
      field('发表时间',['发表年份'],dateHint,false),field('作者顺序',[],'',false),field('论文链接',['DOI','链接'],'',false),field('摘要',[],'',false)
    ],'在投不等于已发表；没有发表时间时留空。',false),
    section('patents','专利',['专利成果'],true,[
      field('专利名称',['标题']),field('专利类型'),field('专利状态'),field('申请号'),field('申请时间',[],dateHint),field('授权时间',[],dateHint,false),field('发明人排序',[],'',false)
    ],'',false),
    section('summary','自我评价',['自我介绍','自我描述'],false,[field('自我评价'),field('个人优势',[],'',false),field('兴趣爱好',[],'',false)]),
    section('family','家庭成员',['家庭背景','家庭情况'],true,[field('成员姓名',['姓名']),field('与本人关系',['关系']),field('工作单位',['单位']),field('职业',['职务']),field('联系电话',['电话'],'',false)],'按申请需要选用，每位成员一条记录。',false),
    section('contact','紧急联系人',['紧急联系信息'],true,[field('联系人姓名',['姓名']),field('与本人关系',['关系']),field('联系人电话',['联系电话','电话'])],'联系人电话与本人手机号分别保存。',false)
  ];
  const norm=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,'');
  function getSection(name) {
    const hits=sections.filter(s=>[s.name,...s.aliases].some(n=>norm(n)===norm(name)));
    return hits.length===1?hits[0]:null;
  }
  function definition(section,label) {
    const hits=(section?.fields||[]).filter(f=>[f.label,...f.aliases].some(n=>norm(n)===norm(label)));
    return hits.length===1?hits[0]:null;
  }
  function missing(section,fields,coreOnly=false) {
    return (section?.fields||[]).filter(f=>(!coreOnly||f.core)&&!fields.some(old=>definition(section,old.label||old.key)===f));
  }
  function addMissing(template,recordId,coreOnly=true,label='') {
    const T=root.ResumeProTree,found=T.findRecord(template,recordId);
    if(!found)return 0;
    const section=getSection(found.group.name);
    const additions=missing(section,found.fields,coreOnly).filter(f=>!label||f.label===label);
    additions.forEach(f=>T.addField(template,recordId,f.label));
    return additions.length;
  }
  function addSections(template,ids) {
    const T=root.ResumeProTree,result={groups:0,fields:0,skipped:[]};
    for(const section of sections.filter(s=>ids.includes(s.id))) {
      const matches=template.groups.filter(g=>getSection(g.name)?.id===section.id);
      if(matches.length>1){result.skipped.push(section.name);continue;}
      let g=matches[0];
      if(!g){g=T.addGroup(template,section.name);result.groups++;}
      // Existing records may contain mixed legacy entries; only the record-level button adds fields there.
      if(!section.repeat&&!g.records.length){const r=T.addRecord(template,g.id,'基本资料');result.fields+=addMissing(template,r.id);}
    }
    return result;
  }
  function recordIssues(section,fields) {
    if(!section)return [];
    const issues=[];
    for(const d of section.fields) {
      const hits=fields.filter(f=>definition(section,f.label||f.key)===d);
      if(hits.length>1)issues.push(`“${d.label}”有多个同义字段，请核对后手动归并`);
    }
    const dateValue=labels=>{
      const hits=fields.filter(f=>labels.includes(definition(section,f.label||f.key)?.label)&&String(f.value).trim());
      if(hits.length!==1)return null;
      const m=String(hits[0].value).trim().match(/^(\d{4})(?:[-年/.](\d{1,2}))?(?:[-月/.](\d{1,2}))?[日月]?$/);
      if(!m||+m[2]>12||+m[2]===0||+m[3]>31||+m[3]===0)return null;
      return [+m[1],m[2]?+m[2]:null,m[3]?+m[3]:null];
    };
    const a=dateValue(['开始时间','入学时间']),b=dateValue(['结束时间','毕业时间']);
    if(a&&b)for(let i=0;i<3;i++) {
      if(a[i]===null||b[i]===null)break;
      if(a[i]>b[i]){issues.push('开始时间晚于结束时间，请核对；系统不会自动交换');break;}
      if(a[i]<b[i])break;
    }
    return issues;
  }
  function extractionSchema() {
    return {schemaVersion:1,sections:sections.map(s=>({id:s.id,name:s.name,repeat:s.repeat,note:s.note,
      fields:s.fields.map(f=>({label:f.label,aliases:f.aliases,hint:f.hint,common:f.core}))}))};
  }
  const api={sections,getSection,definition,missing,addMissing,addSections,recordIssues,extractionSchema};
  root.ResumeProSchema=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
