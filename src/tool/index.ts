// 工具声明：原创航海经商游戏（自定义界面，存档只存在本机，不联网）。
import { Ship } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'x01',
  name: '原创航海经商游戏',
  tagline: '原创世界的像素风航海经商游戏：驾船穿行群岛，在 12 个港口间买卖、补给、造船、招人，完成季度目标。',
  icon: Ship,
  category: '休闲游戏',
  type: 'media',
  mode: 'custom',
  mainLabel: '航海',
  params: [],
  Main: () => createElement(Main),
};

export default tool;
