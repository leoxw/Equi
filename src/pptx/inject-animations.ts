import JSZip from "jszip";
import type { BuiltSlideMeta } from "./build-slide";

interface AnimTarget {
  adcode: string;
  provinceSpId: string;
  calloutSpIds: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find cNvPr id for a shape by its name attribute inside slide XML.
 */
function findShapeIdByName(slideXml: string, name: string): string | null {
  const re = new RegExp(
    `<p:cNvPr([^>]*\\bid="(\\d+)"[^>]*\\bname="${escapeRegex(name)}"[^>]*|[^>]*\\bname="${escapeRegex(name)}"[^>]*\\bid="(\\d+)"[^>]*)(?:/>|>)`,
  );
  const m = slideXml.match(re);
  if (!m) return null;
  return m[2] || m[3] || null;
}

function nextIdFactory(start: number): () => number {
  let n = start;
  return () => {
    n += 1;
    return n;
  };
}

/**
 * Build PowerPoint timing XML: for each province in order,
 * onClick → pulse province (3 beats) → appear callout shapes.
 */
function buildTimingXml(targets: AnimTarget[]): string {
  const nextId = nextIdFactory(1);
  const rootId = nextId();
  const seqId = nextId();

  const clickPars: string[] = [];
  const bldEntries: string[] = [];

  for (const t of targets) {
    for (const spid of t.calloutSpIds) {
      bldEntries.push(`<p:bldP spid="${spid}" grpId="0"/>`);
    }

    const pulseInner = buildPulseGroup(t.provinceSpId, nextId);
    const appearInner = t.calloutSpIds
      .map((spid) => buildAppear(spid, nextId))
      .join("");

    // One click advances one province package: pulse then appear.
    const clickParId = nextId();
    const afterParId = nextId();
    clickPars.push(`
      <p:par>
        <p:cTn id="${clickParId}" presetID="6" presetClass="emph" presetSubtype="0" fill="hold" nodeType="clickEffect">
          <p:stCondLst>
            <p:cond delay="indefinite"/>
          </p:stCondLst>
          <p:childTnLst>
            ${pulseInner}
            <p:par>
              <p:cTn id="${afterParId}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" nodeType="afterEffect">
                <p:stCondLst>
                  <p:cond delay="0"/>
                </p:stCondLst>
                <p:childTnLst>
                  ${appearInner}
                </p:childTnLst>
              </p:cTn>
            </p:par>
          </p:childTnLst>
        </p:cTn>
      </p:par>`);
  }

  return `
  <p:timing>
    <p:tnLst>
      <p:par>
        <p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot">
          <p:childTnLst>
            <p:seq concurrent="1" nextAc="seek">
              <p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq">
                <p:childTnLst>
                  ${clickPars.join("\n")}
                </p:childTnLst>
              </p:cTn>
              <p:prevCondLst>
                <p:cond evt="onPrev" delay="0">
                  <p:tgtEl>
                    <p:sldTgt/>
                  </p:tgtEl>
                </p:cond>
              </p:prevCondLst>
              <p:nextCondLst>
                <p:cond evt="onNext" delay="0">
                  <p:tgtEl>
                    <p:sldTgt/>
                  </p:tgtEl>
                </p:cond>
              </p:nextCondLst>
            </p:seq>
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:tnLst>
    <p:bldLst>
      ${bldEntries.join("\n")}
    </p:bldLst>
  </p:timing>`;
}

function buildPulseGroup(spid: string, nextId: () => number): string {
  // Three scale pulses ≈ “闪烁/脉冲”
  const beats = [0, 280, 560];
  return beats
    .map((delay) => {
      const parId = nextId();
      const animId = nextId();
      return `
      <p:par>
        <p:cTn id="${parId}" fill="hold">
          <p:stCondLst>
            <p:cond delay="${delay}"/>
          </p:stCondLst>
          <p:childTnLst>
            <p:animScale>
              <p:cBhvr>
                <p:cTn id="${animId}" dur="280" autoRev="1" fill="hold"/>
                <p:tgtEl>
                  <p:spTgt spid="${spid}"/>
                </p:tgtEl>
              </p:cBhvr>
              <p:from x="100000" y="100000"/>
              <p:to x="112000" y="112000"/>
            </p:animScale>
          </p:childTnLst>
        </p:cTn>
      </p:par>`;
    })
    .join("");
}

function buildAppear(spid: string, nextId: () => number): string {
  const parId = nextId();
  const setId = nextId();
  return `
    <p:par>
      <p:cTn id="${parId}" fill="hold">
        <p:stCondLst>
          <p:cond delay="0"/>
        </p:stCondLst>
        <p:childTnLst>
          <p:set>
            <p:cBhvr>
              <p:cTn id="${setId}" dur="1" fill="hold">
                <p:stCondLst>
                  <p:cond delay="0"/>
                </p:stCondLst>
              </p:cTn>
              <p:tgtEl>
                <p:spTgt spid="${spid}"/>
              </p:tgtEl>
              <p:attrNameLst>
                <p:attrName>style.visibility</p:attrName>
              </p:attrNameLst>
            </p:cBhvr>
            <p:to>
              <p:strVal val="visible"/>
            </p:to>
          </p:set>
        </p:childTnLst>
      </p:cTn>
    </p:par>`;
}

function injectTimingIntoSlide(slideXml: string, timingXml: string): string {
  if (slideXml.includes("<p:timing>")) {
    return slideXml.replace(/<p:timing>[\s\S]*?<\/p:timing>/, timingXml.trim());
  }
  // Insert before closing </p:sld>
  if (slideXml.includes("</p:sld>")) {
    return slideXml.replace("</p:sld>", `${timingXml}\n</p:sld>`);
  }
  throw new Error("无法在 slide XML 中定位插入点");
}

export async function injectAnimations(
  pptxBlob: Blob,
  meta: BuiltSlideMeta,
  selectedOrder: string[],
): Promise<Blob> {
  const zip = await JSZip.loadAsync(pptxBlob);
  const slideFile =
    zip.file("ppt/slides/slide1.xml") ??
    Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort()
      .map((k) => zip.file(k))[0];

  if (!slideFile) {
    throw new Error("PPTX 中未找到幻灯片 XML");
  }

  let slideXml = await slideFile.async("string");

  const targets: AnimTarget[] = [];
  for (const adcode of selectedOrder) {
    const provName = meta.provinceShapeNames.find((p) => p.adcode === adcode)?.shapeName;
    if (!provName) continue;
    const provinceSpId = findShapeIdByName(slideXml, provName);
    if (!provinceSpId) {
      console.warn("未找到省份形状", provName);
      continue;
    }

    const calloutNames = meta.calloutShapeNames
      .filter((c) => c.adcode === adcode)
      .map((c) => c.shapeName);
    const calloutSpIds = calloutNames
      .map((n) => findShapeIdByName(slideXml, n))
      .filter((id): id is string => Boolean(id));

    targets.push({ adcode, provinceSpId, calloutSpIds });
  }

  if (targets.length === 0) {
    return pptxBlob;
  }

  const timingXml = buildTimingXml(targets);
  slideXml = injectTimingIntoSlide(slideXml, timingXml);
  zip.file(slideFile.name, slideXml);

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
