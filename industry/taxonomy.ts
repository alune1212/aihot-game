// 这个行业的分类体系：类别、标签词表、游戏与厂商名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换游戏或加游戏时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。
// 「游戏」这一维用主题目录里 key 仍为 company 的那一组（框架只有 company / field / genre 三组）。
// 加一款游戏：在 ENTITIES 登记，再在 topics.json 的 company 组加一条 entityId。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（攻略、改枪、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进最后一个分节。
 * tagColor 是飞书推送卡片里跟在标题后面的这一类小标签的颜色（飞书 text_tag 的颜色名）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "patch", tagColor: "indigo", label: "版本", feedLabel: "版本更新", section: "版本更新", guide: "游戏版本、赛季开启、停机维护窗口里的玩法或枪械平衡、新武器或新地图正式上线。单纯预告没有上线日期的，不算这次版本更新。皮肤或通行证上架归活动。" },
  { key: "official", tagColor: "orange", label: "公告", feedLabel: "官方公告", section: "官方公告", guide: "官方已经发生的维护、补偿、封禁、安全处罚、停服和账号规则。带态度的玩家评论不是公告。赛事结果归赛事。" },
  { key: "event", tagColor: "turquoise", label: "活动", feedLabel: "游戏活动", section: "活动", guide: "限时活动、通行证、外观、福利、兑换和联动上架。版本本体的平衡和赛季规则归版本，职业比赛归赛事。" },
  { key: "loadout", tagColor: "green", label: "改枪", feedLabel: "改枪码", section: "攻略与改枪", guide: "可以照着用的改枪码、配装方案、价格和适用模式（烽火地带或全面战场）。只讲某把枪强不强、没有方案的，归攻略。", commentary: true },
  { key: "guide", tagColor: "violet", label: "攻略", feedLabel: "攻略", section: "攻略与改枪", guide: "地图、撤离点、模式打法、干员用法和版本环境说明。重点是可照着做的做法；只有态度没有做法归观点。", commentary: true },
  { key: "esports", tagColor: "purple", label: "赛事", feedLabel: "赛事", section: "赛事", guide: "职业联赛、世界杯、主播赛的赛程、结果和规则。普通限时活动不是赛事。" },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布：版本更新。日报报头的数字按「类别是 patch 且标签含版本更新」来数。
 * unit 接在数字后面。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "patch", tag: "版本更新", unit: "次版本更新" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["pc", "pvp", "pve", "gti", "ue5"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里）。
 * 键名沿用框架的七类，评分权重表不用改；含义在提示词里换成游戏资讯。
 */
export const ITEM_TYPES = ["model_release", "product_launch", "tool_or_prompt", "research_paper", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "版本更新", "内容上新", "活动", "官方公告", "改枪方案", "攻略教学", "赛事", "玩家观点", "机制数据", "其他",
] as const;

/** 可选的主题标签。加游戏时不要把枪械名塞进这里，枪械名录在改枪模块。 */
export const TOPIC_TAGS = [
  "烽火地带", "全面战场", "战役", "地图撤离", "赛季通行证", "干员", "枪械平衡", "安全封禁",
] as const;

/** 可选的实体标签（游戏、厂商）。显示名要和 ENTITIES.displayTag 一致。 */
export const ENTITY_TAGS = ["三角洲行动", "天美", "琳琅天上"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  版本: "版本更新", 赛季更新: "版本更新", 热更: "版本更新", 补丁: "版本更新",
  新地图: "内容上新", 新干员: "内容上新", 新武器: "内容上新", 上新: "内容上新",
  公告: "官方公告", 维护: "官方公告", 停服: "官方公告", 补偿: "官方公告",
  封禁: "安全封禁", 外挂: "安全封禁", 处罚: "安全封禁",
  改枪: "改枪方案", 改枪码: "改枪方案", 配装: "改枪方案", 枪码: "改枪方案",
  攻略: "攻略教学", 教程: "攻略教学", 指南: "攻略教学", 撤离: "地图撤离",
  通行证: "赛季通行证", 战令: "赛季通行证",
  观点: "玩家观点", 环境: "枪械平衡", 平衡性: "枪械平衡", 强度: "枪械平衡",
  比赛: "赛事", 联赛: "赛事",
  烽火: "烽火地带", 大战场: "全面战场",
};

// ── 游戏与厂商 ──────────────────────────────────────────────────────────────────────────

/**
 * 主体名录：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；orgNames 是发消息时开头用的组织名；otherNames 是其他称呼。
 * 游戏是这一维的主体。厂商留下来，是为了把官方账号对到对的主体，避免标题里写错制作组。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  "delta-force": {
    name: "三角洲行动",
    displayTag: "三角洲行动",
    aliases: ["三角洲行动", "Delta Force", "三角洲", "GTI"],
    orgNames: ["三角洲行动"],
    otherNames: ["三角洲行动官方"],
  },
  timi: {
    name: "天美工作室群",
    displayTag: "天美",
    aliases: ["天美", "TiMi", "天美工作室群"],
    orgNames: ["天美工作室群", "TiMi Studio Group"],
    otherNames: ["天美工作室"],
  },
  "team-jade": {
    name: "琳琅天上",
    displayTag: "琳琅天上",
    aliases: ["琳琅天上", "Team Jade", "Jade"],
    orgNames: ["琳琅天上"],
    otherNames: ["琳琅天上团队"],
  },
};

/**
 * 身份词典：摘要和标题里出现的这些名字，必须在原文里也出现过，否则退回原标题、丢掉摘要。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "delta-force", name: "三角洲行动", patterns: [/三角洲行动|三角洲|\bdelta\s*force\b|\bgti\b/i] },
  { id: "timi", name: "天美工作室群", patterns: [/天美|\btimi\b/i] },
  { id: "team-jade", name: "琳琅天上", patterns: [/琳琅天上|\bteam\s*jade\b|\bjade\b/i] },
];

/** 这些域名上的文章，发布方就是对应的主体（Steam 商店是平台，不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "delta-force", domains: ["df.qq.com", "playdeltaforce.com"] },
];

/** 原文里的这些写法也算提到了对应主体。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "delta-force", pattern: /@DeltaForce_Game\b/i },
];
