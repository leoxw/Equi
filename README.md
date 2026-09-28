# Equi · 中国分省地图 PPTX 生成器

纯前端工具：配置幻灯片尺寸、高亮省份与提示数据后，一键下载**单页**中国分省地图 PPTX。放映时每次点击依次让对应省份脉冲闪烁，并弹出数据框。

## 使用

```bash
npm install
npm run dev
```

浏览器打开提示的本地地址，在左侧配置：

1. 选择幻灯片尺寸（16:9 / 4:3 / 16:10 / 自定义英寸）
2. 勾选要介绍的省份，用 ↑↓ 调整介绍顺序
3. 为每省填写弹出标题与键值参数（可增减）
4. 可选调整主题色
5. 点击 **生成并下载 PPTX**

用 PowerPoint 或 WPS 打开放映模式：每点一次鼠标，当前省脉冲，随后数据框出现。

## 技术说明

- Vite + TypeScript
- 省界数据：DataV 中国省级 GeoJSON（已简化）
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) 绘制可编辑自定义几何省份
- JSZip 注入 OOXML `timing`：省份 `animScale` 脉冲 + 数据框 `appear`

## 脚本

```bash
npm run build          # 生产构建
npx tsx scripts/smoke-pptx.mts   # 无头生成并校验动画 XML
```
