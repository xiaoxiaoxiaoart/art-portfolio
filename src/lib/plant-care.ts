interface CareProfile {
  chineseName: string;
  category: string;
  light: string;
  water_frequency_days: number;
  dormant_water_frequency_days: number;
  temp_range: string;
  humidity: string;
  fertilizer_notes: string;
}

const foliageFertilizer = '春夏有新生长时，可用半浓度均衡液肥，每 2–4 周一次；生长停缓时暂停。';

// 这组养护建议适用于资料中明确喜少水的两种肉质大戟及其缀化品种。
const succulentSpurgeCare = {
  category: '多肉',
  light: '放在明亮处，可逐步适应日照；刚换位置时避开午后暴晒。',
  water_frequency_days: 14,
  dormant_water_frequency_days: 28,
  temp_range: '喜温暖，冬季避霜冻和冷风。',
  humidity: '适合偏干燥、通风的环境；盆土干透再浇，避免积水。',
  fertilizer_notes: '有新生长时，可偶尔用半浓度多肉液肥；生长停缓时暂停。',
};

// 按学名匹配。天数是盆栽检查提醒的起点，应根据盆土干湿调整。
// 养护参考 NC State Extension 的对应物种条目及 UMN Extension 的室内盆栽指南。
const profiles: Record<string, CareProfile> = {
  'epipremnum aureum': {
    chineseName: '绿萝',
    category: '观叶',
    light: '明亮散射光，耐较低光照；避免强直射。',
    water_frequency_days: 7,
    dormant_water_frequency_days: 14,
    temp_range: '温暖室温，避免低温和冷风。',
    humidity: '普通室内湿度即可，空气过干时可适当增湿。',
    fertilizer_notes: foliageFertilizer,
  },
  'monstera deliciosa': {
    chineseName: '龟背竹',
    category: '观叶',
    light: '明亮散射光，避免午后强直射。',
    water_frequency_days: 7,
    dormant_water_frequency_days: 14,
    temp_range: '温暖室温，避免霜冻和冷风。',
    humidity: '偏好较高的空气湿度，保持通风。',
    fertilizer_notes: foliageFertilizer,
  },
  'zamioculcas zamiifolia': {
    chineseName: '金钱树',
    category: '观叶',
    light: '明亮散射光，耐较低光照；避免强直射。',
    water_frequency_days: 14,
    dormant_water_frequency_days: 28,
    temp_range: '温暖室温，避免低温。',
    humidity: '普通室内湿度即可，盆土干透再浇。',
    fertilizer_notes: '生长季少量施稀释的均衡液肥，生长停缓时暂停。',
  },
  'dracaena trifasciata': {
    chineseName: '虎尾兰',
    category: '多肉',
    light: '明亮散射光，耐低光；换到更强光处时逐渐适应。',
    water_frequency_days: 14,
    dormant_water_frequency_days: 28,
    temp_range: '温暖室温，避免霜冻和冷风。',
    humidity: '耐较干燥的室内空气，盆土干透再浇。',
    fertilizer_notes: '生长季少量施稀释的均衡液肥，生长停缓时暂停。',
  },
  'chlorophytum comosum': {
    chineseName: '吊兰',
    category: '观叶',
    light: '明亮散射光，避开正午直射。',
    water_frequency_days: 7,
    dormant_water_frequency_days: 14,
    temp_range: '温和室温，避免霜冻。',
    humidity: '普通室内湿度即可，避免长期闷湿。',
    fertilizer_notes: foliageFertilizer,
  },
  'spathiphyllum wallisii': {
    chineseName: '白掌',
    category: '观花',
    light: '明亮散射光，也可放在较低光照处；避免直射。',
    water_frequency_days: 5,
    dormant_water_frequency_days: 10,
    temp_range: '温暖室温，避开冷风。',
    humidity: '偏好较高的空气湿度；盆土保持微润，避免积水。',
    fertilizer_notes: foliageFertilizer,
  },
  'ficus elastica': {
    chineseName: '橡皮树',
    category: '观叶',
    light: '明亮散射光，避免突然移到强直射处。',
    water_frequency_days: 7,
    dormant_water_frequency_days: 14,
    temp_range: '温暖室温，避免低温和冷风。',
    humidity: '普通至中等室内湿度，避免靠近暖气或空调出风口。',
    fertilizer_notes: foliageFertilizer,
  },
  // 金刚纂、麒麟掌和春峰参考新加坡国家公园局的对应条目。
  'euphorbia neriifolia': { ...succulentSpurgeCare, chineseName: '金刚纂' },
  "euphorbia neriifolia 'cristata'": { ...succulentSpurgeCare, chineseName: '麒麟掌' },
  'euphorbia lactea': { ...succulentSpurgeCare, chineseName: '龟纹箭' },
  "euphorbia lactea 'cristata'": { ...succulentSpurgeCare, chineseName: '春峰' },
  'cereus hildmannianus': {
    chineseName: '秘鲁天轮柱',
    category: '仙人掌',
    light: '适合日照充足的位置，逐步适应直射阳光。',
    water_frequency_days: 14,
    dormant_water_frequency_days: 28,
    temp_range: '生长期喜温暖，盆栽越冬避免霜冻。',
    humidity: '适合偏干燥、通风的环境；生长季盆土干透再浇，冬季减少浇水。',
    fertilizer_notes: '生长季可少量用半浓度仙人掌液肥；生长停缓时暂停。',
  },
  'hibiscus rosa-sinensis': {
    chineseName: '朱槿',
    category: '观花',
    light: '放在光线充足的位置，逐渐适应直射阳光。',
    water_frequency_days: 3,
    dormant_water_frequency_days: 7,
    temp_range: '白天约 18–24°C 有利于孕蕾，避免冷风。',
    humidity: '空气保持适度湿润和流通，盆土避免积水。',
    fertilizer_notes: '生长和开花期间按肥料标签施用均衡肥，低光和生长停缓时减少。',
  },
};

export function plantCareProfile(scientificName: string): CareProfile | undefined {
  const name = scientificName.toLowerCase().trim()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
  const acceptedName = name === 'sansevieria trifasciata'
    ? 'dracaena trifasciata'
    : name.replace(/ (?:f\.|var\.)?\s*cristata$/, " 'cristata'");
  return Object.prototype.hasOwnProperty.call(profiles, acceptedName) ? profiles[acceptedName] : undefined;
}
