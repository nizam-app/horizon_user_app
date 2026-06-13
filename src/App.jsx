import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  ClipboardCheck,
  Copy,
  FileCheck2,
  FlipHorizontal,
  HelpCircle,
  MapPin,
  MousePointer2,
  PenLine,
  PenTool,
  PencilLine,
  Redo2,
  RotateCcw,
  RotateCw,
  Shield,
  Trash2,
  Type,
  Undo2,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';

import { requireApiBase } from './apiBase.js';
import { fetchPrefillFromReference } from './claimPrefillApi.js';

const checklistOptions = [
  { key: 'license', label: 'Driver License' },
  { key: 'taxiAuthority', label: 'Taxi Authority' },
  { key: 'registration', label: 'Copy of Registration' },
  { key: 'otherDemand', label: 'Other Party Demand (if applicable)' },
  { key: 'policeReport', label: 'Police Report (if applicable)' },
  { key: 'excessPayment', label: 'Excess Payment' },
  { key: 'repairQuote', label: 'Repair Quote' },
  { key: 'otherParties', label: 'Full Details of Other Parties Involved' },
];

const relationshipOptions = [
  'Owner',
  'Driver',
  'Employee',
  'Contract / Casual Driver',
  'Relative',
  'Other',
];

const roadSurfaceOptions = ['Dry', 'Wet', 'Loose', 'Flood'];
const vehicleStateOptions = ['Moving', 'Stationary', 'Parked'];
const trafficControlOptions = ['None', 'Stop Sign', 'Traffic Lights', 'Roundabout', 'Give Way', 'Merge'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const wizardSteps = [
  {
    id: 'checklist',
    title: 'Documents checklist',
    shortTitle: 'Documents',
    icon: ClipboardCheck,
    description: 'Tick what you have ready and upload photos. You can come back to finish later.',
    tip: 'Not everything is required today — mark what applies to your situation.',
  },
  {
    id: 'member',
    title: 'Your vehicle',
    shortTitle: 'Vehicle',
    icon: Car,
    description: 'Your member details, vehicle registration, and how we can reach you.',
    tip: 'Use the same details as on your registration papers.',
  },
  {
    id: 'driver',
    title: 'Driver details',
    shortTitle: 'Driver',
    icon: UserRound,
    description: 'Who was driving, licence information, and any police or liability details.',
    tip: 'If you were not the driver, say how you are related to the vehicle owner.',
  },
  {
    id: 'incident',
    title: 'What happened',
    shortTitle: 'Incident',
    icon: AlertTriangle,
    description: 'When and where the accident happened, road conditions, and a short description.',
    tip: 'Write it in your own words — approximate time and location are fine.',
  },
  {
    id: 'accidentSketch',
    title: 'Accident sketch',
    shortTitle: 'Sketch',
    icon: PenTool,
    description: 'Draw a simple diagram of the scene or upload a photo of a sketch.',
    tip: 'Show where each vehicle was and the direction of travel.',
  },
  {
    id: 'others',
    title: 'Damage & other parties',
    shortTitle: 'Damage',
    icon: Users,
    description: 'Mark damage on your vehicle, towing details, and other people involved.',
    tip: 'Tap the diagram to place damage markers, or draw directly on the image.',
  },
  {
    id: 'declaration',
    title: 'Review & sign',
    shortTitle: 'Sign',
    icon: PencilLine,
    description: 'Check the summary, agree to the declaration, and sign to submit.',
    tip: 'Use Preview to double-check everything before you submit.',
  },
];

const blankOtherParty = () => ({
  plateNumber: '',
  make: '',
  model: '',
  color: '',
  driverName: '',
  ownerDetails: '',
  address: '',
  mobile: '',
  email: '',
  licenceNumber: '',
  expiryDate: '',
  dateOfBirth: '',
  insuranceCompany: '',
  claimNumber: '',
  licenceFrontAttachments: [],
  licenceBackAttachments: [],
});

const getEmailError = (value) => {
  const normalized = value.trim();
  if (!normalized) return '';
  return emailPattern.test(normalized) ? '' : 'Enter a valid email address.';
};

const formatIncidentDay = (dateValue) => {
  if (!dateValue) return '';
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
};

const cleanValue = (value) => value.trim();

const joinDriverFullName = (driver) =>
  [driver.firstName, driver.lastName].map((part) => cleanValue(part || '')).filter(Boolean).join(' ');

const joinDriverPostalAddress = (driver) => {
  const street = cleanValue(driver.streetAddress || '');
  const suburb = cleanValue(driver.suburb || '');
  const state = cleanValue(driver.state || '');
  const postcode = cleanValue(driver.postcode || '');
  const locality = [suburb, state, postcode].filter(Boolean).join(' ');
  return [street, locality].filter(Boolean).join(', ');
};
const mapChecklistFileMeta = (list) =>
  (list ?? []).map(({ name, source, mimeType, dataUrl }) => ({
    name,
    source,
    ...(mimeType ? { mimeType } : {}),
    ...(typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? { dataUrl } : {}),
  }));

const MAX_ATTACHMENT_DATA_URL_BYTES = 3_500_000;

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const appendChecklistEvidenceFiles = async (setList, fileList, source) => {
  if (!fileList?.length) return;
  const files = Array.from(fileList);
  const added = await Promise.all(
    files.map(async (file) => {
      const row = {
        id: `${source}-${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`,
        name: file.name,
        source,
        mimeType: file.type || '',
      };
      const canEmbed =
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        /\.(jpe?g|png|gif|webp|bmp|heic|pdf)$/i.test(file.name);
      if (canEmbed) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          if (dataUrl && dataUrl.length <= MAX_ATTACHMENT_DATA_URL_BYTES) {
            row.dataUrl = dataUrl;
          }
        } catch {
          /* keep filename metadata */
        }
      }
      return row;
    }),
  );
  setList((prev) => [...prev, ...added]);
};

const accidentSketchSummaryForDeclaration = (sketch) => {
  const drawn = Boolean(sketch?.diagramDataUrl);
  const n = sketch?.attachments?.length ?? 0;
  if (drawn && n > 0) return `Drawn + ${n} file${n === 1 ? '' : 's'}`;
  if (drawn) return 'Drawn';
  if (n > 0) return `${n} file${n === 1 ? '' : 's'} uploaded`;
  return 'Not drawn (optional)';
};

const accidentSketchSummaryForReview = (sketch) => {
  const drawn = Boolean(sketch?.diagramDataUrl);
  const n = sketch?.attachments?.length ?? 0;
  if (drawn && n > 0) return `Drawing + ${n} attachment${n === 1 ? '' : 's'}`;
  if (drawn) return 'Drawing only';
  if (n > 0) return `${n} attachment${n === 1 ? '' : 's'}`;
  return 'Not provided';
};

const SKETCH_CANVAS_WIDTH = 960;
const SKETCH_CANVAS_HEIGHT = 540;
const SKETCH_INK = '#1e293b';
const SKETCH_LINE_WIDTH = 3.2;
const SKETCH_LABEL_FONT_PX = 24;
/** Side-profile cutout stamps — your = red (faces right), other = orange (faces left). */
const SKETCH_VEHICLE_BODY_W = 140;
const SKETCH_VEHICLE_BODY_H = 58;
const SKETCH_CAR_SELF_SRC = `${import.meta.env.BASE_URL}sketch/cars/car-self.png`;
const SKETCH_CAR_OTHER_SRC = `${import.meta.env.BASE_URL}sketch/cars/car-other.png`;

const SKETCH_VEHICLE_PALETTE = {
  self: {
    bodyTop: '#ef4444',
    bodyBottom: '#b91c1c',
    stroke: '#7f1d1d',
    glass: '#0f172a',
    glassOpacity: 0.88,
    wheel: '#18181b',
    hub: '#52525b',
    headlight: '#fef08a',
    taillight: '#fecaca',
    mirror: '#991b1b',
  },
  other: {
    bodyTop: '#3b82f6',
    bodyBottom: '#1d4ed8',
    stroke: '#1e3a8a',
    glass: '#0f172a',
    glassOpacity: 0.88,
    wheel: '#18181b',
    hub: '#52525b',
    headlight: '#fef08a',
    taillight: '#bfdbfe',
    mirror: '#1e40af',
  },
};

/** Sedan plan-view body outline — faces +X, centered at origin, ~132×52 logical units. */
function traceSketchVehicleBodyPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(62, 0);
  ctx.bezierCurveTo(66, -5, 65.5, -14, 58, -21);
  ctx.bezierCurveTo(52, -25, 46, -26, 38, -26);
  ctx.lineTo(22, -26);
  ctx.bezierCurveTo(12, -27, 4, -27, -6, -26.5);
  ctx.bezierCurveTo(-18, -26, -28, -26, -38, -24.5);
  ctx.bezierCurveTo(-50, -23, -58, -18, -63, -10);
  ctx.bezierCurveTo(-66, -4, -66, 4, -63, 10);
  ctx.bezierCurveTo(-58, 18, -50, 23, -38, 24.5);
  ctx.bezierCurveTo(-28, 26, -18, 26, -6, 26.5);
  ctx.bezierCurveTo(4, 27, 12, 27, 22, 26);
  ctx.lineTo(38, 26);
  ctx.bezierCurveTo(46, 26, 52, 25, 58, 21);
  ctx.bezierCurveTo(65.5, 14, 66, 5, 62, 0);
  ctx.closePath();
}

function drawSketchVehicleGlyph(ctx, role, bw, bh) {
  const palette = SKETCH_VEHICLE_PALETTE[role === 'self' ? 'self' : 'other'];
  const sx = bw / 132;
  const sy = bh / 52;

  ctx.save();
  ctx.scale(sx, sy);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.beginPath();
  ctx.ellipse(0, 30, 52, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  traceSketchVehicleBodyPath(ctx);
  const bodyGrad = ctx.createLinearGradient(0, -26, 0, 26);
  bodyGrad.addColorStop(0, palette.bodyTop);
  bodyGrad.addColorStop(1, palette.bodyBottom);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = `rgba(15, 23, 42, ${palette.glassOpacity})`;
  ctx.beginPath();
  ctx.moveTo(14, -18);
  ctx.lineTo(28, -20);
  ctx.lineTo(36, -16);
  ctx.lineTo(36, 16);
  ctx.lineTo(28, 20);
  ctx.lineTo(14, 18);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(42, -19);
  ctx.lineTo(54, -20);
  ctx.lineTo(58, -16);
  ctx.lineTo(58, 16);
  ctx.lineTo(54, 20);
  ctx.lineTo(42, 19);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(-20, -3, 72, 6);

  const wheelPositions = [
    [34, -27], [34, 27], [-34, -27], [-34, 27],
  ];
  wheelPositions.forEach(([wx, wy]) => {
    ctx.fillStyle = palette.wheel;
    ctx.beginPath();
    ctx.ellipse(wx, wy, 6.5, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.hub;
    ctx.beginPath();
    ctx.ellipse(wx, wy, 2.8, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = palette.mirror;
  ctx.beginPath();
  ctx.ellipse(20, -28, 3.2, 1.8, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(20, 28, 3.2, 1.8, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.headlight;
  ctx.beginPath();
  ctx.ellipse(59, -14, 3.5, 2.2, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(59, 14, 3.5, 2.2, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.taillight;
  ctx.beginPath();
  ctx.ellipse(-61, -12, 2.8, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-61, 12, 2.8, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSketchCarPhoto(ctx, carImage, bw, bh) {
  const iw = carImage.naturalWidth;
  const ih = carImage.naturalHeight;
  if (!iw || !ih) return;
  const scale = Math.min(bw / iw, bh / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const prevSmooth = ctx.imageSmoothingEnabled;
  const prevQuality = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(carImage, -dw / 2, -dh / 2, dw, dh);
  ctx.imageSmoothingEnabled = prevSmooth;
  ctx.imageSmoothingQuality = prevQuality;
}

/** Default rotation step: 15° — fast alignment for accident diagrams. */
const SKETCH_VEHICLE_ROTATE_STEP = Math.PI / 12;
/** Fine step with Shift held: 5° — small corrections without cluttering the default. */
const SKETCH_VEHICLE_ROTATE_STEP_FINE = Math.PI / 36;

function emptySketchModel() {
  return { lines: [], vehicles: [], labels: [] };
}

function normalizeSketchModel(raw) {
  if (!raw || typeof raw !== 'object') return emptySketchModel();
  return {
    lines: Array.isArray(raw.lines) ? raw.lines : [],
    vehicles: Array.isArray(raw.vehicles) ? raw.vehicles : [],
    labels: Array.isArray(raw.labels) ? raw.labels : [],
  };
}

function makeSketchId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function drawSketchRoundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Horizontal mirror when flipX is set (Flip tool in Select mode).
 */
function sketchVehicleMirrorX(v) {
  return Boolean(v.flipX);
}

/**
 * Hit-test in vehicle body space (matches draw order: translate → rotate → scaleX when mirrored).
 */
function sketchPointInVehicleBody(px, py, v) {
  const th = v.angle ?? 0;
  const dx = px - v.x;
  const dy = py - v.y;
  const c = Math.cos(-th);
  const s = Math.sin(-th);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  const mirrored = sketchVehicleMirrorX(v);
  const lx = mirrored ? -rx : rx;
  const ly = ry;
  const halfW = SKETCH_VEHICLE_BODY_W / 2;
  const halfH = SKETCH_VEHICLE_BODY_H / 2;
  return lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH;
}

function drawSketchVehicleSelectionHalo(ctx, v) {
  const bw = SKETCH_VEHICLE_BODY_W;
  const bh = SKETCH_VEHICLE_BODY_H;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle ?? 0);
  if (sketchVehicleMirrorX(v)) ctx.scale(-1, 1);
  ctx.strokeStyle = 'rgba(13, 148, 136, 0.95)';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([6, 4]);
  drawSketchRoundRectPath(ctx, -bw / 2 - 4, -bh / 2 - 4, bw + 8, bh + 8, 10);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSketchVehicleShape(ctx, v, carImages) {
  const bw = SKETCH_VEHICLE_BODY_W;
  const bh = SKETCH_VEHICLE_BODY_H;
  const role = v.role === 'self' ? 'self' : 'other';
  const carImage = role === 'self' ? carImages?.self : carImages?.other;

  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle ?? 0);
  if (sketchVehicleMirrorX(v)) ctx.scale(-1, 1);

  if (carImage && carImage.complete && carImage.naturalWidth > 0) {
    ctx.shadowColor = 'rgba(15, 23, 42, 0.15)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    drawSketchCarPhoto(ctx, carImage, bw, bh);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  } else {
    drawSketchVehicleGlyph(ctx, role, bw, bh);
  }

  ctx.restore();
}

function drawSketchLabel(ctx, lb) {
  const text = lb.text || '';
  if (!text) return;
  const fontSize = SKETCH_LABEL_FONT_PX;
  const font = `600 ${fontSize}px Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const padX = 14;
  const padY = 10;
  const x = lb.x + padX;
  const y = lb.y + padY;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = SKETCH_INK;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawSketchPaperBackground(ctx, width, height) {
  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  const step = 28;
  for (let gx = 0; gx <= width; gx += step) {
    for (let gy = 0; gy <= height; gy += step) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function redrawAccidentSketch(canvas, model, carImages, selectedVehicleId) {
  const m = normalizeSketchModel(model);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  drawSketchPaperBackground(ctx, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SKETCH_INK;
  ctx.lineWidth = SKETCH_LINE_WIDTH;
  m.lines.forEach((line) => {
    if (!line.points || line.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(line.points[0].x, line.points[0].y);
    for (let i = 1; i < line.points.length; i++) {
      ctx.lineTo(line.points[i].x, line.points[i].y);
    }
    ctx.stroke();
  });
  m.vehicles.forEach((v) => drawSketchVehicleShape(ctx, v, carImages));
  m.labels.forEach((lb) => drawSketchLabel(ctx, lb));
  if (selectedVehicleId) {
    const sv = m.vehicles.find((v) => v.id === selectedVehicleId);
    if (sv) drawSketchVehicleSelectionHalo(ctx, sv);
  }
}

const VEHICLE_DAMAGE_DIAGRAM_SRC = '/vehicle-damage-diagram.svg';

const damagePhotoCountFromState = (sceneList, detailList) =>
  (sceneList?.length ?? 0) + (detailList?.length ?? 0);

function generateClaimReferenceCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `HR-${seg(4)}-${seg(4)}`;
}

function normalizeClaimReferenceCode(raw) {
  let alnum = String(raw ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (alnum.startsWith('HR') && alnum.length === 10) {
    alnum = alnum.slice(2);
  }
  if (alnum.length !== 8 || !/^[A-Z0-9]{8}$/.test(alnum)) return null;
  return `HR-${alnum.slice(0, 4)}-${alnum.slice(4)}`;
}

const MAX_OTHER_VEHICLES = 4;

const parseOtherVehicleCountForSync = (raw) => {
  const cleaned = String(raw ?? '').replace(/[^\d]/g, '');
  if (cleaned === '') return 0;
  const n = parseInt(cleaned, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.min(MAX_OTHER_VEHICLES, n);
};

const syncOtherPartiesToOtherVehicleCount = (existing, otherVehicleCount) => {
  const n = Math.max(0, Math.floor(otherVehicleCount));
  if (n <= 0) return [];
  if (existing.length === n) return existing;
  if (existing.length > n) return existing.slice(0, n);
  const toAdd = n - existing.length;
  const blanks = Array.from({ length: toAdd }, () => blankOtherParty());
  return [...existing, ...blanks];
};

function EvidenceUploadPanel({
  title,
  description,
  attachments,
  onAppendFiles,
  onRemoveFile,
  className = 'mt-4 rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-3 sm:px-4',
}) {
  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{title}</p>
      <p className="mt-1 text-xs text-slate-600">{description}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          className="touch-target inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-teal-600 bg-white px-3 py-2.5 text-xs font-semibold text-teal-900 transition hover:bg-teal-50 sm:py-2"
        >
          <Upload size={16} />
          Choose file
        </button>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="touch-target inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-teal-600 bg-teal-700 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-teal-800 sm:py-2"
        >
          <Camera size={15} />
          Take photo
        </button>
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        className="sr-only"
        accept="image/*,.pdf,application/pdf"
        multiple
        onChange={(e) => {
          onAppendFiles(e.target.files, 'upload');
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        className="sr-only"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(e) => {
          onAppendFiles(e.target.files, 'camera');
          e.target.value = '';
        }}
      />
      {attachments.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{att.name}</span>
                <span className="ml-1.5 text-slate-500">({att.source === 'camera' ? 'Camera' : 'Upload'})</span>
              </span>
              <button
                type="button"
                onClick={() => onRemoveFile(att.id)}
                className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label={`Remove ${att.name}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OtherPartyLicenceFrontBackPanel({
  frontAttachments,
  backAttachments,
  onAppendFront,
  onRemoveFront,
  onAppendBack,
  onRemoveBack,
}) {
  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white px-3 py-3 sm:px-4 shadow-sm">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">Other driver&apos;s licence</p>
        <p className="mt-1 text-xs text-slate-600">Add a clear photo of the front and back of their licence (optional).</p>
      </div>
      <EvidenceUploadPanel
        title="Front of licence"
        description="Upload or photograph the front of their driver licence."
        className="rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-3"
        attachments={frontAttachments}
        onAppendFiles={onAppendFront}
        onRemoveFile={onRemoveFront}
      />
      <EvidenceUploadPanel
        title="Back of licence"
        description="Upload or photograph the back of their driver licence."
        className="rounded-lg border border-stone-200 bg-stone-50/80 px-3 py-3"
        attachments={backAttachments}
        onAppendFiles={onAppendBack}
        onRemoveFile={onRemoveBack}
      />
    </div>
  );
}

function OtherPartyVehicleCard({ party, index, emailError, onFieldChange, onAppendLicenceFiles, onRemoveLicenceFile }) {
  const frontFiles = party.licenceFrontAttachments ?? [];
  const backFiles = party.licenceBackAttachments ?? [];
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="mb-4">
        <h4 className="font-semibold text-slate-900">Other Vehicle {index + 1}</h4>
        <p className="text-sm text-slate-600">Details for the other party involved.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Vehicle Plate Number" value={party.plateNumber} onChange={(value) => onFieldChange('plateNumber', value)} />
        <Field label="Make" value={party.make} onChange={(value) => onFieldChange('make', value)} />
        <Field label="Model" value={party.model} onChange={(value) => onFieldChange('model', value)} />
        <Field label="Color" value={party.color} onChange={(value) => onFieldChange('color', value)} />
        <Field label="Driver Name" value={party.driverName} onChange={(value) => onFieldChange('driverName', value)} />
        <Field label="Owner Details" value={party.ownerDetails} onChange={(value) => onFieldChange('ownerDetails', value)} />
        <Field label="Address" value={party.address} onChange={(value) => onFieldChange('address', value)} />
        <Field label="Mobile" value={party.mobile} onChange={(value) => onFieldChange('mobile', value)} />
        <Field
          type="email"
          label="Email"
          value={party.email}
          onChange={(value) => onFieldChange('email', value)}
          error={emailError}
          autoComplete="email"
          inputMode="email"
        />
        <Field label="Licence No." value={party.licenceNumber} onChange={(value) => onFieldChange('licenceNumber', value)} />
        <Field type="date" label="Expiry Date" value={party.expiryDate} onChange={(value) => onFieldChange('expiryDate', value)} />
        <Field type="date" label="Date of Birth" value={party.dateOfBirth} onChange={(value) => onFieldChange('dateOfBirth', value)} />
        <div className="md:col-span-2 xl:col-span-4">
          <OtherPartyLicenceFrontBackPanel
            frontAttachments={frontFiles}
            backAttachments={backFiles}
            onAppendFront={(files, source) => onAppendLicenceFiles('front', files, source)}
            onRemoveFront={(id) => onRemoveLicenceFile('front', id)}
            onAppendBack={(files, source) => onAppendLicenceFiles('back', files, source)}
            onRemoveBack={(id) => onRemoveLicenceFile('back', id)}
          />
        </div>
        <Field label="Insurance Company Details" value={party.insuranceCompany} onChange={(value) => onFieldChange('insuranceCompany', value)} />
        <Field label="Claim Number" value={party.claimNumber} onChange={(value) => onFieldChange('claimNumber', value)} />
      </div>
    </div>
  );
}

const buildClaimPayload = (
  claim,
  signatureDataUrl,
  driverLicenseFrontAttachments,
  driverLicenseBackAttachments,
  taxiAuthorityAttachments,
  registrationAttachments
) => {
  const incidentDay = formatIncidentDay(claim.incident.date);

  const checklist = { ...claim.checklist };
  if (driverLicenseFrontAttachments.length > 0 || driverLicenseBackAttachments.length > 0) {
    checklist.license = true;
  }
  if (taxiAuthorityAttachments.length > 0) checklist.taxiAuthority = true;
  if (registrationAttachments.length > 0) checklist.registration = true;

  return {
    checklist,
    driverLicenseFrontAttachments: mapChecklistFileMeta(driverLicenseFrontAttachments),
    driverLicenseBackAttachments: mapChecklistFileMeta(driverLicenseBackAttachments),
    taxiAuthorityAttachments: mapChecklistFileMeta(taxiAuthorityAttachments),
    registrationAttachments: mapChecklistFileMeta(registrationAttachments),
    excessPaymentApplicability:
      !claim.checklist.excessPayment || !claim.excessPaymentApplicability
        ? ''
        : claim.excessPaymentApplicability === 'applicable'
          ? 'Applicable'
          : 'Non applicable',
    excessPaymentAmount:
      !claim.checklist.excessPayment || claim.excessPaymentApplicability !== 'applicable'
        ? ''
        : cleanValue(claim.excessPaymentAmount || ''),
    repairQuoteRef:
      !claim.checklist.repairQuote ? '' : cleanValue(claim.repairQuoteRef || ''),
    memberVehicle: {
      memberNumber: cleanValue(claim.memberVehicle.memberNumber),
      claimType: claim.memberVehicle.claimType,
      plateNumber: cleanValue(claim.memberVehicle.plateNumber),
      kilometers: cleanValue(claim.memberVehicle.kilometers),
      make: cleanValue(claim.memberVehicle.make),
      model: cleanValue(claim.memberVehicle.model),
      monthYear: cleanValue(claim.memberVehicle.monthYear),
      ownerName: cleanValue(claim.memberVehicle.ownerName),
      address: cleanValue(claim.memberVehicle.address),
      mobile: cleanValue(claim.memberVehicle.mobile),
      email: cleanValue(claim.memberVehicle.email),
    },
    driver: {
      isOwner: claim.driver.isOwner,
      claimNumber: cleanValue(claim.driver.claimNumber),
      firstName: cleanValue(claim.driver.firstName),
      lastName: cleanValue(claim.driver.lastName),
      name: joinDriverFullName(claim.driver),
      streetAddress: cleanValue(claim.driver.streetAddress),
      suburb: cleanValue(claim.driver.suburb),
      state: cleanValue(claim.driver.state),
      postcode: cleanValue(claim.driver.postcode),
      address: joinDriverPostalAddress(claim.driver),
      mobile: cleanValue(claim.driver.mobile),
      email: cleanValue(claim.driver.email),
      licenceNumber: cleanValue(claim.driver.licenceNumber),
      expiryDate: claim.driver.expiryDate,
      dateOfBirth: claim.driver.dateOfBirth,
      yearOfHold: cleanValue(claim.driver.yearOfHold),
      relationship: claim.driver.relationship,
      relationshipOther: cleanValue(claim.driver.relationshipOther),
      alcoholOrDrug: claim.driver.alcoholOrDrug,
      breathTest: claim.driver.breathTest,
      policeReported: cleanValue(claim.driver.policeReportNumber) ? 'Yes' : claim.driver.policeReported,
      policeReportNumber: cleanValue(claim.driver.policeReportNumber),
      atFault: claim.driver.atFault,
      admittedLiability: claim.driver.atFault === 'Yes' ? claim.driver.admittedLiability : '',
      otherDriverAdmittedLiability: claim.driver.atFault === 'No' ? claim.driver.otherDriverAdmittedLiability : '',
    },
    incident: {
      date: claim.incident.date,
      day: incidentDay,
      time: claim.incident.time,
      addressDetailOptional: cleanValue(claim.incident.addressDetailOptional),
      streetName: cleanValue(claim.incident.streetName),
      suburb: cleanValue(claim.incident.suburb),
      roadSurface: claim.incident.roadSurface,
      numberOfVehicles: cleanValue(claim.incident.numberOfVehicles),
      coveredVehicleState: claim.incident.coveredVehicleState,
      trafficControls: claim.incident.trafficControls,
      description: cleanValue(claim.incident.description),
      estimatedSpeed: cleanValue(claim.incident.estimatedSpeed),
      estimatedOtherSpeed: cleanValue(claim.incident.estimatedOtherSpeed),
    },
    accidentSketch: {
      diagramDataUrl: claim.accidentSketch.diagramDataUrl || '',
      sketchModel: normalizeSketchModel(claim.accidentSketch.sketchModel),
      attachments: mapChecklistFileMeta(claim.accidentSketch.attachments ?? []),
    },
    damage: {
      claimingDamage: claim.damage.claimingDamage,
      towed: claim.damage.towed,
      towCompany: claim.damage.towed === 'Yes' ? cleanValue(claim.damage.towCompany) : '',
      towLocation: claim.damage.towed === 'Yes' ? cleanValue(claim.damage.towLocation) : '',
      distanceTowed: claim.damage.towed === 'Yes' ? cleanValue(claim.damage.distanceTowed) : '',
      currentVehicleLocation: cleanValue(claim.damage.currentVehicleLocation),
      diagram: {
        markers: claim.damage.diagramPoints,
        strokes: claim.damage.diagramStrokes.map(({ id, points }) => ({ id, points })),
        scenePhotos: mapChecklistFileMeta(claim.damage.diagramScenePhotos),
        detailPhotos: mapChecklistFileMeta(claim.damage.diagramDetailPhotos),
      },
    },
    otherParties: claim.otherParties.map((party) => ({
      plateNumber: cleanValue(party.plateNumber),
      make: cleanValue(party.make),
      model: cleanValue(party.model),
      color: cleanValue(party.color),
      driverName: cleanValue(party.driverName),
      ownerDetails: cleanValue(party.ownerDetails),
      address: cleanValue(party.address),
      mobile: cleanValue(party.mobile),
      email: cleanValue(party.email),
      licenceNumber: cleanValue(party.licenceNumber),
      expiryDate: party.expiryDate,
      dateOfBirth: party.dateOfBirth,
      insuranceCompany: cleanValue(party.insuranceCompany),
      claimNumber: cleanValue(party.claimNumber),
      licenceFrontAttachments: mapChecklistFileMeta(party.licenceFrontAttachments ?? []),
      licenceBackAttachments: mapChecklistFileMeta(party.licenceBackAttachments ?? []),
    })),
    witnessDetails: [
      {
        name: cleanValue(claim.witnessDetails.witness1Name),
        address: cleanValue(claim.witnessDetails.witness1Address),
        mobile: cleanValue(claim.witnessDetails.witness1Mobile),
        email: cleanValue(claim.witnessDetails.witness1Email),
      },
      {
        name: cleanValue(claim.witnessDetails.witness2Name),
        address: cleanValue(claim.witnessDetails.witness2Address),
        mobile: cleanValue(claim.witnessDetails.witness2Mobile),
        email: cleanValue(claim.witnessDetails.witness2Email),
      },
    ].filter((witness) => witness.name || witness.address || witness.mobile || witness.email),
    declaration: {
      agreed: claim.declaration.agreed,
      signedBy: claim.declaration.signedBy,
      typedName: cleanValue(claim.declaration.typedName),
      date: claim.declaration.date,
      signatureDataUrl,
    },
  };
};

const createInitialClaim = () => ({
  checklist: {
    license: false,
    taxiAuthority: false,
    registration: false,
    otherDemand: false,
    policeReport: false,
    excessPayment: false,
    repairQuote: false,
    otherParties: false,
  },
  excessPaymentApplicability: '',
  excessPaymentAmount: '',
  repairQuoteRef: '',
  memberVehicle: {
    memberNumber: '',
    claimType: 'Claim',
    plateNumber: '',
    kilometers: '',
    make: '',
    model: '',
    monthYear: '',
    ownerName: '',
    address: '',
    mobile: '',
    email: '',
  },
  driver: {
    isOwner: true,
    claimNumber: '',
    firstName: '',
    lastName: '',
    streetAddress: '',
    suburb: '',
    state: '',
    postcode: '',
    mobile: '',
    email: '',
    licenceNumber: '',
    expiryDate: '',
    dateOfBirth: '',
    yearOfHold: '',
    relationship: 'Owner',
    relationshipOther: '',
    alcoholOrDrug: 'No',
    breathTest: 'No',
    policeReported: 'No',
    policeReportNumber: '',
    atFault: 'No',
    admittedLiability: 'No',
    otherDriverAdmittedLiability: 'No',
  },
  incident: {
    date: '',
    time: '',
    addressDetailOptional: '',
    streetName: '',
    suburb: '',
    roadSurface: 'Dry',
    numberOfVehicles: '0',
    coveredVehicleState: 'Moving',
    trafficControls: [],
    description: '',
    estimatedSpeed: '',
    estimatedOtherSpeed: '',
  },
  accidentSketch: {
    diagramDataUrl: '',
    sketchModel: emptySketchModel(),
    attachments: [],
  },
  damage: {
    claimingDamage: 'Yes',
    towed: 'No',
    towCompany: '',
    towLocation: '',
    distanceTowed: '',
    currentVehicleLocation: '',
    diagramPoints: [],
    diagramStrokes: [],
    diagramScenePhotos: [],
    diagramDetailPhotos: [],
  },
  otherParties: [],
  witnessDetails: {
    witness1Name: '',
    witness1Address: '',
    witness1Mobile: '',
    witness1Email: '',
    witness2Name: '',
    witness2Address: '',
    witness2Mobile: '',
    witness2Email: '',
  },
  declaration: {
    agreed: true,
    signedBy: 'Driver',
    typedName: '',
    date: '',
  },
});

const CLAIM_DRAFT_KEY = 'horizon-user-claim-draft-v1';

const hydrateClaimFromDraft = (draftClaim) => {
  const base = createInitialClaim();
  if (!draftClaim || typeof draftClaim !== 'object') return base;
  return {
    ...base,
    ...draftClaim,
    checklist: { ...base.checklist, ...(draftClaim.checklist || {}) },
    memberVehicle: { ...base.memberVehicle, ...(draftClaim.memberVehicle || {}) },
    driver: { ...base.driver, ...(draftClaim.driver || {}) },
    incident: { ...base.incident, ...(draftClaim.incident || {}) },
    accidentSketch: {
      ...base.accidentSketch,
      ...(draftClaim.accidentSketch || {}),
      sketchModel: draftClaim.accidentSketch?.sketchModel ?? base.accidentSketch.sketchModel,
    },
    damage: { ...base.damage, ...(draftClaim.damage || {}) },
    witnessDetails: { ...base.witnessDetails, ...(draftClaim.witnessDetails || {}) },
    declaration: { ...base.declaration, ...(draftClaim.declaration || {}) },
    otherParties: Array.isArray(draftClaim.otherParties) ? draftClaim.otherParties : base.otherParties,
    excessPaymentApplicability: draftClaim.excessPaymentApplicability ?? base.excessPaymentApplicability,
    excessPaymentAmount: draftClaim.excessPaymentAmount ?? base.excessPaymentAmount,
    repairQuoteRef: draftClaim.repairQuoteRef ?? base.repairQuoteRef,
  };
};

const loadClaimDraft = () => {
  try {
    const raw = localStorage.getItem(CLAIM_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const saveClaimDraft = (payload) => {
  try {
    localStorage.setItem(CLAIM_DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
};

const clearClaimDraft = () => {
  try {
    localStorage.removeItem(CLAIM_DRAFT_KEY);
  } catch {
    /* ignore */
  }
};

function ChecklistEvidencePanel({
  title,
  description,
  cameraButtonLabel,
  attachments,
  uploadInputRef,
  cameraInputRef,
  appendFiles,
  removeAttachment,
}) {
  return (
    <div className="border-t border-teal-200/70 bg-white/50 px-4 pb-4 pt-3 rounded-b-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-teal-600 bg-white px-4 py-3 text-sm font-semibold text-teal-900 transition hover:bg-teal-50"
        >
          <Upload size={18} />
          Upload file
        </button>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-teal-600 bg-teal-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-800"
        >
          <Camera size={18} />
          {cameraButtonLabel}
        </button>
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        className="sr-only"
        accept="image/*,.pdf,application/pdf"
        multiple
        onChange={(e) => {
          appendFiles(e.target.files, 'upload');
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        className="sr-only"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(e) => {
          appendFiles(e.target.files, 'camera');
          e.target.value = '';
        }}
      />
      {attachments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{att.name}</span>
                <span className="ml-2 text-xs text-slate-500">({att.source === 'camera' ? 'Camera' : 'Upload'})</span>
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="shrink-0 rounded-lg p-1 text-slate-500 transition hover:bg-stone-100 hover:text-slate-900"
                aria-label={`Remove ${att.name}`}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DamageViewDualPhotoPanel({
  sceneAttachments,
  detailAttachments,
  onAppendScene,
  onRemoveScene,
  onAppendDetail,
  onRemoveDetail,
}) {
  return (
    <div className="mt-4 space-y-4">
      <EvidenceUploadPanel
        title="Photos — wide / overview"
        description="Optional. Full view or context for this angle."
        className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3"
        attachments={sceneAttachments}
        onAppendFiles={onAppendScene}
        onRemoveFile={onRemoveScene}
      />
      <EvidenceUploadPanel
        title="Photos — close-up / damage"
        description="Optional. Close-up of dents, scrapes, or impact area."
        className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3"
        attachments={detailAttachments}
        onAppendFiles={onAppendDetail}
        onRemoveFile={onRemoveDetail}
      />
    </div>
  );
}

function MobileStepStrip({ steps, currentStep, onStepChange }) {
  return (
    <div className="sticky top-0 z-20 border-b border-stone-200/90 bg-white/95 shadow-sm backdrop-blur-md xl:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-xs font-semibold text-slate-900">
          Step {currentStep + 1} of {steps.length}
        </p>
        <p className="truncate text-xs text-slate-500">{steps[currentStep]?.title}</p>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none">
        {steps.map((step, index) => {
          const active = index === currentStep;
          const done = index < currentStep;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onStepChange(index)}
              aria-current={active ? 'step' : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-left transition touch-target ${
                active
                  ? 'border-teal-800 bg-teal-800 text-white shadow-sm'
                  : done
                    ? 'border-teal-200 bg-teal-50 text-teal-900'
                    : 'border-stone-200 bg-white text-slate-600'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  active ? 'bg-white/15 text-white' : done ? 'bg-teal-700 text-white' : 'bg-stone-100 text-slate-600'
                }`}
              >
                {done ? <Check size={14} /> : index + 1}
              </span>
              <span className="text-xs font-semibold">{step.shortTitle}</span>
            </button>
          );
        })}
      </div>
      <div className="h-1 bg-stone-100">
        <div
          className="h-full bg-teal-700 transition-all duration-300 ease-out"
          style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function WizardFooterNav({ currentStep, totalSteps, onPrevious, onNext, onPreview, onSubmit }) {
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/90 bg-white/95 shadow-nav backdrop-blur-md xl:relative xl:bottom-auto xl:z-auto xl:mt-5 xl:rounded-2xl xl:border xl:shadow-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between xl:px-5 xl:py-4 xl:pb-4">
        <div className="hidden min-w-0 sm:block xl:flex-1">
          <p className="text-sm font-semibold text-slate-900">
            {isLast ? 'Ready to submit?' : 'Continue when this section looks correct'}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {isLast
              ? 'Preview your answers, then submit when you are happy.'
              : 'Your progress is saved automatically on this device.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onPrevious}
            disabled={isFirst}
            className="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft size={16} aria-hidden />
            Back
          </button>
          {isLast ? (
            <>
              <button
                type="button"
                onClick={onPreview}
                className="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-stone-50 sm:px-4"
              >
                <FileCheck2 size={16} aria-hidden />
                Preview
              </button>
              <button
                type="button"
                onClick={onSubmit}
                className="col-span-2 touch-target inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 sm:col-span-1"
              >
                <FileCheck2 size={16} aria-hidden />
                Submit claim
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onNext}
              className="touch-target inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
            >
              Continue
              <ArrowRight size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const initialDraft = useMemo(() => loadClaimDraft(), []);
  const [currentStep, setCurrentStep] = useState(() => initialDraft?.currentStep ?? 0);
  const [claim, setClaim] = useState(() => hydrateClaimFromDraft(initialDraft?.claim));
  const [driverLicenseFrontAttachments, setDriverLicenseFrontAttachments] = useState(
    () => initialDraft?.driverLicenseFrontAttachments ?? [],
  );
  const [driverLicenseBackAttachments, setDriverLicenseBackAttachments] = useState(
    () => initialDraft?.driverLicenseBackAttachments ?? [],
  );
  const [taxiAuthorityAttachments, setTaxiAuthorityAttachments] = useState(
    () => initialDraft?.taxiAuthorityAttachments ?? [],
  );
  const [registrationAttachments, setRegistrationAttachments] = useState(
    () => initialDraft?.registrationAttachments ?? [],
  );
  const taxiAuthorityUploadInputRef = useRef(null);
  const taxiAuthorityCameraInputRef = useRef(null);
  const registrationUploadInputRef = useRef(null);
  const registrationCameraInputRef = useRef(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState(() => initialDraft?.signatureDataUrl ?? '');
  const [notice, setNotice] = useState(null);
  const [reviewPayload, setReviewPayload] = useState(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [submissionState, setSubmissionState] = useState({
    open: false,
    status: 'idle',
    referenceCode: null,
    errorMessage: null,
    emailSent: null,
  });
  const [prefillCodeInput, setPrefillCodeInput] = useState('');
  const [prefillBusy, setPrefillBusy] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [prefillExpanded, setPrefillExpanded] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(() => initialDraft?.savedAt ?? null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ok = saveClaimDraft({
        currentStep,
        claim,
        driverLicenseFrontAttachments,
        driverLicenseBackAttachments,
        taxiAuthorityAttachments,
        registrationAttachments,
        signatureDataUrl,
        savedAt: Date.now(),
      });
      if (ok) setDraftSavedAt(Date.now());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    currentStep,
    claim,
    driverLicenseFrontAttachments,
    driverLicenseBackAttachments,
    taxiAuthorityAttachments,
    registrationAttachments,
    signatureDataUrl,
  ]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  useEffect(() => {
    const target = parseOtherVehicleCountForSync(claim.incident.numberOfVehicles);
    const rawDigits = String(claim.incident.numberOfVehicles ?? '').replace(/[^\d]/g, '');
    const normalizedDisplay = rawDigits === '' ? '' : String(target);
    setClaim((c) => {
      const next = syncOtherPartiesToOtherVehicleCount(c.otherParties, target);
      const countMismatch = c.incident.numberOfVehicles !== normalizedDisplay;
      if (next === c.otherParties && !countMismatch) return c;
      return {
        ...c,
        ...(countMismatch ? { incident: { ...c.incident, numberOfVehicles: normalizedDisplay } } : {}),
        ...(next !== c.otherParties ? { otherParties: next } : {}),
      };
    });
  }, [claim.incident.numberOfVehicles, currentStep]);

  const stepCompletion = useMemo(
    () => Math.round(((currentStep + 1) / wizardSteps.length) * 100),
    [currentStep]
  );

  const completedChecklistCount = checklistOptions.filter((option) => claim.checklist[option.key]).length;
  const damagePointCount = claim.damage.diagramPoints.length;
  const damagePhotoCount = damagePhotoCountFromState(claim.damage.diagramScenePhotos, claim.damage.diagramDetailPhotos);
  const damageStrokeCount = claim.damage.diagramStrokes.length;
  const incidentDay = formatIncidentDay(claim.incident.date);
  const memberVehicleEmailError = getEmailError(claim.memberVehicle.email);
  const driverEmailError = getEmailError(claim.driver.email);
  const otherPartyEmailErrors = claim.otherParties.map((party) => getEmailError(party.email));
  const witness1EmailError = getEmailError(claim.witnessDetails.witness1Email);
  const witness2EmailError = getEmailError(claim.witnessDetails.witness2Email);
  const hasEmailErrors = Boolean(
    memberVehicleEmailError ||
      driverEmailError ||
      otherPartyEmailErrors.some(Boolean) ||
      witness1EmailError ||
      witness2EmailError
  );
  const completionCards = [
    { label: 'Checklist Ready', value: `${completedChecklistCount}/${checklistOptions.length}` },
    { label: 'Damage Markers', value: `${damagePointCount}` },
    { label: 'Damage Sketches', value: `${damageStrokeCount}` },
    { label: 'Damage Photos', value: `${damagePhotoCount}` },
    { label: 'Other Parties', value: `${claim.otherParties.length}` },
  ];

  const updateSection = (section, key, value) => {
    setClaim((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }));
  };

  const toggleChecklist = (key) => {
    if (key === 'license' && claim.checklist.license) {
      setDriverLicenseFrontAttachments([]);
      setDriverLicenseBackAttachments([]);
    }
    if (key === 'taxiAuthority' && claim.checklist.taxiAuthority) {
      setTaxiAuthorityAttachments([]);
    }
    if (key === 'registration' && claim.checklist.registration) {
      setRegistrationAttachments([]);
    }
    setClaim((current) => {
      const nextChecked = !current.checklist[key];
      const nextChecklist = { ...current.checklist, [key]: nextChecked };
      const nextDriver =
        key === 'policeReport' && !nextChecked
          ? { ...current.driver, policeReportNumber: '' }
          : current.driver;
      const nextExcessApplicability =
        key === 'excessPayment' && !nextChecked ? '' : current.excessPaymentApplicability;
      const nextExcessAmount =
        key === 'excessPayment' && !nextChecked ? '' : current.excessPaymentAmount;
      const nextRepairQuoteRef =
        key === 'repairQuote' && !nextChecked ? '' : current.repairQuoteRef;
      return {
        ...current,
        checklist: nextChecklist,
        driver: nextDriver,
        excessPaymentApplicability: nextExcessApplicability,
        excessPaymentAmount: nextExcessAmount,
        repairQuoteRef: nextRepairQuoteRef,
      };
    });
  };

  const markChecklistCollected = (key) => {
    setClaim((current) =>
      current.checklist[key]
        ? current
        : {
            ...current,
            checklist: { ...current.checklist, [key]: true },
          },
    );
  };

  const appendDriverLicenseFrontFiles = (fileList, source) => {
    markChecklistCollected('license');
    void appendChecklistEvidenceFiles(setDriverLicenseFrontAttachments, fileList, source);
  };

  const appendDriverLicenseBackFiles = (fileList, source) => {
    markChecklistCollected('license');
    void appendChecklistEvidenceFiles(setDriverLicenseBackAttachments, fileList, source);
  };

  const removeDriverLicenseFrontAttachment = (id) => {
    setDriverLicenseFrontAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const removeDriverLicenseBackAttachment = (id) => {
    setDriverLicenseBackAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const appendTaxiAuthorityFiles = (fileList, source) => {
    markChecklistCollected('taxiAuthority');
    void appendChecklistEvidenceFiles(setTaxiAuthorityAttachments, fileList, source);
  };

  const removeTaxiAuthorityAttachment = (id) => {
    setTaxiAuthorityAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const appendRegistrationFiles = (fileList, source) => {
    markChecklistCollected('registration');
    void appendChecklistEvidenceFiles(setRegistrationAttachments, fileList, source);
  };

  const removeRegistrationAttachment = (id) => {
    setRegistrationAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const toggleTrafficControl = (value) => {
    setClaim((current) => {
      const existing = current.incident.trafficControls;
      const nextControls = existing.includes(value)
        ? existing.filter((item) => item !== value)
        : [...existing, value];

      return {
        ...current,
        incident: {
          ...current.incident,
          trafficControls: nextControls,
        },
      };
    });
  };

  const updateIncidentVehicleCount = (value) => {
    setClaim((current) => {
      const cleaned = String(value ?? '').replace(/[^\d]/g, '');
      const otherCount = parseOtherVehicleCountForSync(value);
      const nextParties = syncOtherPartiesToOtherVehicleCount(current.otherParties, otherCount);
      return {
        ...current,
        incident: {
          ...current.incident,
          numberOfVehicles: cleaned === '' ? '' : String(otherCount),
        },
        otherParties: nextParties,
      };
    });
  };

  const updateOtherParty = (index, key, value) => {
    setClaim((current) => ({
      ...current,
      otherParties: current.otherParties.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item
      ),
    }));
  };

  const appendOtherPartyLicenceFiles = (index, side, fileList, source) => {
    if (!fileList?.length) return;
    if (side !== 'front' && side !== 'back') return;
    const field = side === 'front' ? 'licenceFrontAttachments' : 'licenceBackAttachments';
    const added = Array.from(fileList).map((file) => ({
      id: `other-licence-${side}-${index}-${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`,
      name: file.name,
      source,
    }));
    setClaim((current) => ({
      ...current,
      otherParties: current.otherParties.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: [...(item[field] ?? []), ...added] } : item
      ),
    }));
  };

  const removeOtherPartyLicenceFile = (index, side, id) => {
    if (side !== 'front' && side !== 'back') return;
    const field = side === 'front' ? 'licenceFrontAttachments' : 'licenceBackAttachments';
    setClaim((current) => ({
      ...current,
      otherParties: current.otherParties.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: (item[field] ?? []).filter((a) => a.id !== id) } : item
      ),
    }));
  };

  const addDiagramMarker = (point) => {
    setClaim((current) => ({
      ...current,
      damage: {
        ...current.damage,
        diagramPoints: [...current.damage.diagramPoints, point],
      },
    }));
  };

  const addDiagramStroke = (strokePoints) => {
    if (!strokePoints?.length || strokePoints.length < 2) return;
    const id = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setClaim((current) => ({
      ...current,
      damage: {
        ...current.damage,
        diagramStrokes: [...current.damage.diagramStrokes, { id, points: strokePoints }],
      },
    }));
  };

  const clearDamageDiagram = () => {
    setClaim((current) => ({
      ...current,
      damage: {
        ...current.damage,
        diagramPoints: [],
        diagramStrokes: [],
      },
    }));
  };

  const appendDamageDiagramPhotoFiles = (kind, fileList, source) => {
    if (!fileList?.length) return;
    if (kind !== 'scene' && kind !== 'detail') return;
    const field = kind === 'scene' ? 'diagramScenePhotos' : 'diagramDetailPhotos';
    const added = Array.from(fileList).map((file) => ({
      id: `damage-${kind}-${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`,
      name: file.name,
      source,
    }));
    setClaim((current) => ({
      ...current,
      damage: {
        ...current.damage,
        [field]: [...current.damage[field], ...added],
      },
    }));
  };

  const removeDamageDiagramPhoto = (kind, id) => {
    if (kind !== 'scene' && kind !== 'detail') return;
    const field = kind === 'scene' ? 'diagramScenePhotos' : 'diagramDetailPhotos';
    setClaim((current) => ({
      ...current,
      damage: {
        ...current.damage,
        [field]: current.damage[field].filter((item) => item.id !== id),
      },
    }));
  };

  const appendAccidentSketchFiles = (fileList, source) => {
    if (!fileList?.length) return;
    const added = Array.from(fileList).map((file) => ({
      id: `accident-sketch-${source}-${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 9)}`,
      name: file.name,
      source,
    }));
    setClaim((current) => ({
      ...current,
      accidentSketch: {
        ...current.accidentSketch,
        attachments: [...(current.accidentSketch.attachments ?? []), ...added],
      },
    }));
  };

  const removeAccidentSketchAttachment = (id) => {
    setClaim((current) => ({
      ...current,
      accidentSketch: {
        ...current.accidentSketch,
        attachments: (current.accidentSketch.attachments ?? []).filter((a) => a.id !== id),
      },
    }));
  };

  const prepareSubmission = () => {
    if (hasEmailErrors) {
      setNotice({ type: 'error', message: 'Please correct the invalid email address fields before submitting the claim.' });
      return null;
    }
    if (!claim.declaration.agreed) {
      setNotice({ type: 'error', message: 'You must confirm the declaration before submitting the claim.' });
      return null;
    }
    if (!claim.declaration.typedName.trim()) {
      setNotice({ type: 'error', message: 'Please enter the printed name for the declaration.' });
      return null;
    }
    if (!signatureDataUrl) {
      setNotice({ type: 'error', message: 'Please provide the signature before submitting the claim.' });
      return null;
    }
    return buildClaimPayload(
      claim,
      signatureDataUrl,
      driverLicenseFrontAttachments,
      driverLicenseBackAttachments,
      taxiAuthorityAttachments,
      registrationAttachments
    );
  };

  const openReview = () => {
    const payload = prepareSubmission();
    if (!payload) return;
    setNotice(null);
    setReviewPayload(payload);
    setShowReviewModal(true);
  };

  const completeLocalReset = () => {
    setShowReviewModal(false);
    setClaim(createInitialClaim());
    setDriverLicenseFrontAttachments([]);
    setDriverLicenseBackAttachments([]);
    setTaxiAuthorityAttachments([]);
    setRegistrationAttachments([]);
    setSignatureDataUrl('');
    setCurrentStep(0);
    setReviewPayload(null);
    setPrefillCodeInput('');
    clearClaimDraft();
    setDraftSavedAt(null);
  };

  const resetWizardForm = () => setShowResetConfirm(true);

  const confirmResetWizard = () => {
    setShowResetConfirm(false);
    setNotice(null);
    completeLocalReset();
  };

  const applyPrefillFromReference = async () => {
    const rawInput = String(prefillCodeInput ?? '').trim();
    const code = normalizeClaimReferenceCode(prefillCodeInput);
    if (!code) {
      const compact = rawInput.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const looksLikeSubmittedRef = compact.startsWith('HRZ');
      setNotice({
        type: 'error',
        message: looksLikeSubmittedRef
          ? 'That value (HRZ-…) is our internal file number. Use your member claim reference from your confirmation (format HR-####-####).'
          : 'Enter your claim reference with or without hyphens (for example HR-A1B2-C3D4).',
      });
      return;
    }
    setPrefillBusy(true);
    try {
      const prefill = await fetchPrefillFromReference(code);
      if (!prefill?.memberVehicle && !prefill?.driver) {
        setNotice({
          type: 'error',
          message: 'No claim found for that reference. Check the code from your submission confirmation.',
        });
        return;
      }
      setClaim((prev) => ({
        ...prev,
        memberVehicle: { ...prev.memberVehicle, ...(prefill.memberVehicle || {}) },
        driver: { ...prev.driver, ...(prefill.driver || {}) },
      }));
      setPrefillCodeInput('');
      setNotice({
        type: 'success',
        message:
          'Your contact and licence details were filled in from your previous claim. Complete the rest of this form for your new incident.',
      });
    } catch (e) {
      setNotice({
        type: 'error',
        message:
          e?.message != null
            ? String(e.message)
            : 'Could not reach the server. Check your connection and API address.',
      });
    } finally {
      setPrefillBusy(false);
    }
  };

  const runSubmission = async (payload) => {
    setNotice(null);
    const submittedReferenceCode = generateClaimReferenceCode();
    setShowReviewModal(false);
    setSubmissionState({ open: true, status: 'pending', referenceCode: null, errorMessage: null, emailSent: null });
    try {
      const base = requireApiBase();
      const res = await fetch(`${base}/v1/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ intakeReference: submittedReferenceCode, claim: payload }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        const msg = typeof data?.error === 'string' ? data.error : `Submission failed (${res.status})`;
        setNotice({ type: 'error', message: msg });
        setSubmissionState({
          open: true,
          status: 'error',
          referenceCode: null,
          errorMessage: msg,
          emailSent: null,
        });
        return;
      }
      const displayRef = data.intakeReference || submittedReferenceCode;
      const emailSent = data.emailSent === true;
      window.__HORIZON_CLAIM_PAYLOAD__ = payload;
      setNotice({
        type: 'success',
        message: data.duplicate
          ? 'This claim was already submitted. Your confirmation is shown below.'
          : emailSent
            ? 'Claim lodged successfully. A PDF confirmation was emailed to the office inbox.'
            : 'Claim lodged successfully. Email could not be sent — check API mail settings.',
      });
      setSubmissionState({
        open: true,
        status: 'success',
        referenceCode: displayRef,
        errorMessage: null,
        emailSent: data.duplicate ? null : emailSent,
      });
      completeLocalReset();
    } catch (e) {
      const errMsg =
        e?.message != null ? String(e.message)
        : 'Network error. Check that the API is running and that VITE_API_BASE_URL matches the server address.';
      setNotice({ type: 'error', message: errMsg });
        setSubmissionState({
          open: true,
          status: 'error',
          referenceCode: null,
          errorMessage: errMsg,
          emailSent: null,
        });
    }
  };

  const submitClaim = () => {
    const payload = prepareSubmission();
    if (!payload) return;
    runSubmission(payload);
  };

  const finalizeSubmission = () => {
    const payload = prepareSubmission();
    if (!payload) return;
    runSubmission(payload);
  };

  const renderStepContent = () => {
    switch (wizardSteps[currentStep].id) {
      case 'checklist':
        return (
          <div className="space-y-6">
            <SectionIntro title="Pre-submission checklist" description="Tick off the required documents before the claim is lodged." />
            <div className="grid gap-4 md:grid-cols-2">
              {checklistOptions.map((item) => {
                const checked = claim.checklist[item.key];
                const hasExpandedPanel =
                  item.key === 'license' ||
                  item.key === 'taxiAuthority' ||
                  item.key === 'registration' ||
                  item.key === 'policeReport' ||
                  item.key === 'repairQuote' ||
                  item.key === 'excessPayment';
                return (
                  <div
                    key={item.key}
                    className={`group rounded-2xl border text-left shadow-[0_14px_35px_-32px_rgba(15,23,42,0.55)] transition ${
                      checked ? 'border-teal-700 bg-teal-50 shadow-sm' : 'border-stone-200 bg-white hover:border-teal-200 hover:bg-stone-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleChecklist(item.key)}
                      className={`w-full p-4 text-left transition hover:bg-black/[0.02] group-hover:bg-stone-50/80 ${
                        checked && hasExpandedPanel ? 'rounded-t-2xl' : 'rounded-2xl'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900">{item.label}</p>
                          <p className="mt-1 text-sm text-slate-600">{checked ? 'Collected and ready.' : 'Tap to mark this document as collected.'}</p>
                        </div>
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${
                          checked ? 'border-teal-700 bg-teal-700 text-white' : 'border-stone-300 bg-white text-transparent group-hover:border-teal-300'
                        }`}>
                          <Check size={18} />
                        </span>
                      </div>
                      {checked && (
                        <span className="mt-4 inline-flex rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-teal-800">
                          Collected
                        </span>
                      )}
                    </button>
                    {checked && item.key === 'license' && (
                      <div className="border-t border-teal-200/70 bg-white/50 px-4 pb-4 pt-3 rounded-b-2xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-900">Driver licence</p>
                        <p className="mt-1 text-sm text-slate-600">Upload or photograph the front and back of your driver licence.</p>
                        <div className="mt-4 space-y-4">
                          <EvidenceUploadPanel
                            title="Front of licence"
                            description="Clear photo of the front of your licence."
                            className="rounded-xl border border-teal-100 bg-white px-3 py-3"
                            attachments={driverLicenseFrontAttachments}
                            onAppendFiles={appendDriverLicenseFrontFiles}
                            onRemoveFile={removeDriverLicenseFrontAttachment}
                          />
                          <EvidenceUploadPanel
                            title="Back of licence"
                            description="Clear photo of the back of your licence."
                            className="rounded-xl border border-teal-100 bg-white px-3 py-3"
                            attachments={driverLicenseBackAttachments}
                            onAppendFiles={appendDriverLicenseBackFiles}
                            onRemoveFile={removeDriverLicenseBackAttachment}
                          />
                        </div>
                      </div>
                    )}
                    {checked && item.key === 'taxiAuthority' && (
                      <ChecklistEvidencePanel
                        title="Taxi authority"
                        description="Upload a file from your device or use the camera to photograph the taxi authority documentation."
                        cameraButtonLabel="Take pictures of taxi authority"
                        attachments={taxiAuthorityAttachments}
                        uploadInputRef={taxiAuthorityUploadInputRef}
                        cameraInputRef={taxiAuthorityCameraInputRef}
                        appendFiles={appendTaxiAuthorityFiles}
                        removeAttachment={removeTaxiAuthorityAttachment}
                      />
                    )}
                    {checked && item.key === 'registration' && (
                      <ChecklistEvidencePanel
                        title="Copy of registration"
                        description="Upload a file from your device or use the camera to photograph the registration document."
                        cameraButtonLabel="Take pictures of copy of registration"
                        attachments={registrationAttachments}
                        uploadInputRef={registrationUploadInputRef}
                        cameraInputRef={registrationCameraInputRef}
                        appendFiles={appendRegistrationFiles}
                        removeAttachment={removeRegistrationAttachment}
                      />
                    )}
                    {checked && item.key === 'policeReport' && (
                      <div className="border-t border-teal-200/70 bg-white/50 px-4 pb-4 pt-3 rounded-b-2xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-900">Police report</p>
                        <p className="mt-1 text-sm text-slate-600">
                          Enter the police report number. It will appear on the Driver Details step when you confirm the accident was reported to the police.
                        </p>
                        <div className="mt-3">
                          <Field
                            label="Police Report No."
                            value={claim.driver.policeReportNumber}
                            onChange={(value) => updateSection('driver', 'policeReportNumber', value)}
                          />
                        </div>
                      </div>
                    )}
                    {checked && item.key === 'repairQuote' && (
                      <div className="border-t border-teal-200/70 bg-white/50 px-4 pb-4 pt-3 rounded-b-2xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-900">Repair quote</p>
                        <p className="mt-1 text-sm text-slate-600">
                          Enter the reference or job number from your repair quote so we can match it to your claim.
                        </p>
                        <div className="mt-3">
                          <Field
                            label="Ref / job number"
                            value={claim.repairQuoteRef}
                            onChange={(value) =>
                              setClaim((current) => ({
                                ...current,
                                repairQuoteRef: value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                    {checked && item.key === 'excessPayment' && (
                      <div className="border-t border-teal-200/70 bg-white/50 px-4 pb-4 pt-3 rounded-b-2xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-900">Excess payment</p>
                        <p className="mt-1 text-sm text-slate-600">
                          For Australian motor claims, indicate whether a policy excess applies to this claim.
                        </p>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <TogglePill
                            active={claim.excessPaymentApplicability === 'applicable'}
                            label="Applicable"
                            onClick={() =>
                              setClaim((current) => ({
                                ...current,
                                excessPaymentApplicability: 'applicable',
                              }))
                            }
                          />
                          <TogglePill
                            active={claim.excessPaymentApplicability === 'nonApplicable'}
                            label="Non applicable"
                            onClick={() =>
                              setClaim((current) => ({
                                ...current,
                                excessPaymentApplicability: 'nonApplicable',
                                excessPaymentAmount: '',
                              }))
                            }
                          />
                        </div>
                        {claim.excessPaymentApplicability === 'applicable' ? (
                          <div className="mt-3">
                            <Field
                              label="Amount"
                              value={claim.excessPaymentAmount}
                              onChange={(value) =>
                                setClaim((current) => ({
                                  ...current,
                                  excessPaymentAmount: value,
                                }))
                              }
                              inputMode="decimal"
                            />
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      case 'member':
        return (
          <div className="space-y-5">
            <Card title="Vehicle & membership" subtitle="Details about your vehicle and how you are claiming.">
              <div className="space-y-8">
                <FormSection title="Membership" description="Only fill this in if you have a member number.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Member number"
                      optional
                      placeholder="Leave blank if not applicable"
                      value={claim.memberVehicle.memberNumber}
                      onChange={(value) => updateSection('memberVehicle', 'memberNumber', value)}
                    />
                    <SelectField
                      label="Claim type"
                      value={claim.memberVehicle.claimType}
                      options={['Claim', 'Report Only']}
                      onChange={(value) => updateSection('memberVehicle', 'claimType', value)}
                    />
                  </div>
                </FormSection>
                <FormSection
                  title="Vehicle registration"
                  description="Match what appears on your rego papers."
                  className="border-t border-stone-100 pt-8"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Plate number"
                      placeholder="e.g. ABC123"
                      value={claim.memberVehicle.plateNumber}
                      onChange={(value) => updateSection('memberVehicle', 'plateNumber', value)}
                    />
                    <Field
                      label="Odometer (km)"
                      placeholder="e.g. 85000"
                      inputMode="numeric"
                      value={claim.memberVehicle.kilometers}
                      onChange={(value) => updateSection('memberVehicle', 'kilometers', value)}
                    />
                    <Field
                      label="Make"
                      placeholder="e.g. Toyota"
                      value={claim.memberVehicle.make}
                      onChange={(value) => updateSection('memberVehicle', 'make', value)}
                    />
                    <Field
                      label="Model"
                      placeholder="e.g. Camry"
                      value={claim.memberVehicle.model}
                      onChange={(value) => updateSection('memberVehicle', 'model', value)}
                    />
                    <Field
                      label="Month & year"
                      placeholder="e.g. March 2019"
                      className="sm:col-span-2"
                      value={claim.memberVehicle.monthYear}
                      onChange={(value) => updateSection('memberVehicle', 'monthYear', value)}
                    />
                  </div>
                </FormSection>
              </div>
            </Card>
            <Card title="Owner contact" subtitle="How we can reach the registered owner.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Owner's name"
                  autoComplete="name"
                  value={claim.memberVehicle.ownerName}
                  onChange={(value) => updateSection('memberVehicle', 'ownerName', value)}
                />
                <Field
                  label="Address"
                  autoComplete="street-address"
                  value={claim.memberVehicle.address}
                  onChange={(value) => updateSection('memberVehicle', 'address', value)}
                />
                <Field
                  label="Mobile"
                  autoComplete="tel"
                  inputMode="tel"
                  value={claim.memberVehicle.mobile}
                  onChange={(value) => updateSection('memberVehicle', 'mobile', value)}
                />
                <Field
                  type="email"
                  label="Email"
                  value={claim.memberVehicle.email}
                  onChange={(value) => updateSection('memberVehicle', 'email', value)}
                  error={memberVehicleEmailError}
                  autoComplete="email"
                  inputMode="email"
                />
              </div>
            </Card>
          </div>
        );
      case 'driver': {
        const policeReportNoLocked = claim.driver.policeReportNumber.trim().length > 0;
        return (
          <div className="space-y-6">
            <SectionIntro title="Driver details" description="Record the person driving at the time of the accident." />
            <Card title="Driver identity">
              <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <Label>Was the driver one of the owners?</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <TogglePill active={claim.driver.isOwner} onClick={() => updateSection('driver', 'isOwner', true)} label="Yes" />
                    <TogglePill active={!claim.driver.isOwner} onClick={() => updateSection('driver', 'isOwner', false)} label="No" />
                  </div>
                  <Field label="Claim Number" value={claim.driver.claimNumber} onChange={(value) => updateSection('driver', 'claimNumber', value)} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="First name"
                    value={claim.driver.firstName}
                    onChange={(value) => updateSection('driver', 'firstName', value)}
                    autoComplete="given-name"
                  />
                  <Field
                    label="Last name"
                    value={claim.driver.lastName}
                    onChange={(value) => updateSection('driver', 'lastName', value)}
                    autoComplete="family-name"
                  />
                  <div className="md:col-span-2">
                    <Field
                      label="Street address"
                      value={claim.driver.streetAddress}
                      onChange={(value) => updateSection('driver', 'streetAddress', value)}
                      autoComplete="street-address"
                    />
                  </div>
                  <Field
                    label="Suburb"
                    value={claim.driver.suburb}
                    onChange={(value) => updateSection('driver', 'suburb', value)}
                    autoComplete="address-level2"
                  />
                  <Field
                    label="State"
                    value={claim.driver.state}
                    onChange={(value) => updateSection('driver', 'state', value)}
                    autoComplete="address-level1"
                  />
                  <Field
                    label="Postcode"
                    value={claim.driver.postcode}
                    onChange={(value) => updateSection('driver', 'postcode', value)}
                    autoComplete="postal-code"
                    inputMode="numeric"
                    maxLength={4}
                  />
                  <Field label="Mobile" value={claim.driver.mobile} onChange={(value) => updateSection('driver', 'mobile', value)} />
                  <Field
                    type="email"
                    label="Email"
                    value={claim.driver.email}
                    onChange={(value) => updateSection('driver', 'email', value)}
                    error={driverEmailError}
                    autoComplete="email"
                    inputMode="email"
                  />
                  <Field label="Licence No." value={claim.driver.licenceNumber} onChange={(value) => updateSection('driver', 'licenceNumber', value)} />
                  <Field type="date" label="Expiry Date" value={claim.driver.expiryDate} onChange={(value) => updateSection('driver', 'expiryDate', value)} />
                  <Field type="date" label="Date of Birth" value={claim.driver.dateOfBirth} onChange={(value) => updateSection('driver', 'dateOfBirth', value)} />
                  <Field label="Year of Hold" value={claim.driver.yearOfHold} onChange={(value) => updateSection('driver', 'yearOfHold', value)} />
                </div>
              </div>
            </Card>
            <div className="grid gap-6 xl:grid-cols-2">
              <Card title="Relationship to the insured">
                <div className="grid gap-3 md:grid-cols-2">
                  {relationshipOptions.map((option) => (
                    <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${claim.driver.relationship === option ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-stone-200 bg-white text-slate-700 hover:border-teal-200 hover:bg-stone-50'}`}>
                      <input type="radio" name="relationship" checked={claim.driver.relationship === option} onChange={() => updateSection('driver', 'relationship', option)} className="h-4 w-4 accent-teal-700" />
                      <span className="text-sm font-medium">{option}</span>
                    </label>
                  ))}
                </div>
                {claim.driver.relationship === 'Other' && (
                  <div className="mt-4">
                    <Field label="Relationship details" value={claim.driver.relationshipOther} onChange={(value) => updateSection('driver', 'relationshipOther', value)} />
                  </div>
                )}
              </Card>
              <Card title="Driver declarations">
                <div className="grid gap-4">
                  <YesNoField label="Was the driver under the influence of alcohol or drug within the 24 hours prior to the accident?" value={claim.driver.alcoholOrDrug} onChange={(value) => updateSection('driver', 'alcoholOrDrug', value)} />
                  <YesNoField label="Did the driver undergo a breath test, breath analysis or blood test?" value={claim.driver.breathTest} onChange={(value) => updateSection('driver', 'breathTest', value)} />
                  <YesNoField
                    label="Was the accident reported to the police?"
                    value={policeReportNoLocked ? 'Yes' : claim.driver.policeReported}
                    disabled={policeReportNoLocked}
                    onChange={(value) =>
                      setClaim((current) => ({
                        ...current,
                        driver: {
                          ...current.driver,
                          policeReported: value,
                          policeReportNumber: value === 'No' ? '' : current.driver.policeReportNumber,
                        },
                      }))
                    }
                  />
                  {(claim.driver.policeReported === 'Yes' || policeReportNoLocked) && (
                    <Field label="Police Report No." value={claim.driver.policeReportNumber} onChange={(value) => updateSection('driver', 'policeReportNumber', value)} />
                  )}
                  <YesNoField label="Was the accident your fault?" value={claim.driver.atFault} onChange={(value) => updateSection('driver', 'atFault', value)} />
                  {claim.driver.atFault === 'Yes' && (
                    <YesNoField label="If yes, did you admit liability?" value={claim.driver.admittedLiability} onChange={(value) => updateSection('driver', 'admittedLiability', value)} />
                  )}
                  {claim.driver.atFault === 'No' && (
                    <YesNoField label="If no, did the other driver admit liability?" value={claim.driver.otherDriverAdmittedLiability} onChange={(value) => updateSection('driver', 'otherDriverAdmittedLiability', value)} />
                  )}
                </div>
              </Card>
            </div>
          </div>
        );
      }
      case 'incident':
        return (
          <div className="space-y-6">
            <SectionIntro title="Incident details" description="Capture the date, conditions, and description of the incident." />
            <Card title="Date, time and location">
              <div className="space-y-8">
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">When</p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field type="date" label="Date" value={claim.incident.date} onChange={(value) => updateSection('incident', 'date', value)} />
                    <Field type="time" label="Time" value={claim.incident.time} onChange={(value) => updateSection('incident', 'time', value)} />
                    <ReadOnlyField label="Day" value={incidentDay || 'Auto-filled from date'} />
                  </div>
                </div>
                <div className="border-t border-stone-100 pt-8">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Where</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Field
                        label="Address detail (optional)"
                        value={claim.incident.addressDetailOptional}
                        onChange={(value) => updateSection('incident', 'addressDetailOptional', value)}
                        autoComplete="address-line2"
                      />
                    </div>
                    <Field label="Street name" value={claim.incident.streetName} onChange={(value) => updateSection('incident', 'streetName', value)} autoComplete="address-line1" />
                    <Field label="Suburb" value={claim.incident.suburb} onChange={(value) => updateSection('incident', 'suburb', value)} autoComplete="address-level2" />
                  </div>
                </div>
                <div className="border-t border-stone-100 pt-8">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Other vehicles</p>
                  <div className="flex flex-col gap-3 sm:max-w-[220px]">
                    <Field
                      label="How many other vehicles?"
                      value={claim.incident.numberOfVehicles}
                      onChange={updateIncidentVehicleCount}
                      inputMode="numeric"
                      maxLength={2}
                    />
                  </div>
                </div>
              </div>
            </Card>
            <div className="grid gap-6 xl:grid-cols-3">
              <Card title="Road surface">
                <OptionGrid options={roadSurfaceOptions} value={claim.incident.roadSurface} onChange={(value) => updateSection('incident', 'roadSurface', value)} radioName="road-surface" />
              </Card>
              <Card title="Covered vehicle state">
                <OptionGrid options={vehicleStateOptions} value={claim.incident.coveredVehicleState} onChange={(value) => updateSection('incident', 'coveredVehicleState', value)} radioName="vehicle-state" />
              </Card>
              <Card title="Traffic controls">
                <div className="grid gap-3">
                  {trafficControlOptions.map((option) => (
                    <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${claim.incident.trafficControls.includes(option) ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-stone-200 bg-white text-slate-700 hover:border-teal-200 hover:bg-stone-50'}`}>
                      <input type="checkbox" checked={claim.incident.trafficControls.includes(option)} onChange={() => toggleTrafficControl(option)} className="h-4 w-4 accent-teal-700" />
                      <span className="text-sm font-medium">{option}</span>
                    </label>
                  ))}
                </div>
              </Card>
            </div>
            <Card title="Accident description">
              <div className="grid gap-4 lg:grid-cols-[0.7fr_0.7fr_1.6fr]">
                <Field label="Estimate speed of your vehicle (km/h)" value={claim.incident.estimatedSpeed} onChange={(value) => updateSection('incident', 'estimatedSpeed', value)} />
                <Field label="Estimate speed of other vehicle (km/h)" value={claim.incident.estimatedOtherSpeed} onChange={(value) => updateSection('incident', 'estimatedOtherSpeed', value)} />
                <TextAreaField label="Describe how the accident happened" rows={6} value={claim.incident.description} onChange={(value) => updateSection('incident', 'description', value)} />
              </div>
            </Card>
          </div>
        );
      case 'accidentSketch':
        return (
          <div className="space-y-6">
            <SectionIntro
              title="Accident sketch"
              description="Draw a simple bird's-eye map of the scene — streets, travel directions, and where each vehicle was."
            />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
              <Card title="Sketch canvas" subtitle="Draw roads and arrows, then place vehicle symbols from the toolbar.">
                <AccidentSketchCanvas
                  sketchModel={claim.accidentSketch.sketchModel}
                  onChange={(update) =>
                    setClaim((c) => ({
                      ...c,
                      accidentSketch: {
                        ...c.accidentSketch,
                        diagramDataUrl: update.diagramDataUrl,
                        sketchModel: update.sketchModel,
                      },
                    }))
                  }
                />
                <EvidenceUploadPanel
                  title="Or upload a photo or scan"
                  description="If your sketch is on paper, photograph or scan it and attach here. You can use the canvas above, uploads, or both."
                  className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4"
                  attachments={claim.accidentSketch.attachments ?? []}
                  onAppendFiles={appendAccidentSketchFiles}
                  onRemoveFile={removeAccidentSketchAttachment}
                />
              </Card>
              <Card title="What to include" subtitle="A clear sketch helps us understand the incident faster.">
                <ol className="space-y-4 text-sm text-slate-700">
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-800">1</span>
                    <span>Name streets and any landmarks (e.g. intersection, roundabout).</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-800">2</span>
                    <span>Show direction of travel with arrows on each lane.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-800">3</span>
                    <span className="flex flex-col gap-2">
                      Place your vehicle on the map
                      <SketchCarPreview role="self" label="Your vehicle" accent="self" />
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-800">4</span>
                    <span className="flex flex-col gap-2">
                      Place any other vehicles involved
                      <SketchCarPreview role="other" label="Other vehicle" accent="other" />
                    </span>
                  </li>
                </ol>
                <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
                  Use <span className="font-semibold text-slate-800">Select</span> to move or rotate a vehicle after placing it.
                  Tap <span className="font-semibold text-slate-800">Clear</span> to start over.
                </p>
              </Card>
            </div>
          </div>
        );
      case 'others':
        return (
          <div className="space-y-6">
            <SectionIntro
              title="Damage mapping and other vehicles"
              description="Mark damage, towing, and other parties. Other vehicle blocks are created from the count you entered on Incident Details."
            />
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Card title="Visual damage map">
                <CompositeDamageMap
                  diagramSrc={VEHICLE_DAMAGE_DIAGRAM_SRC}
                  markers={claim.damage.diagramPoints}
                  strokes={claim.damage.diagramStrokes}
                  sceneAttachments={claim.damage.diagramScenePhotos}
                  detailAttachments={claim.damage.diagramDetailPhotos}
                  onAddMarker={addDiagramMarker}
                  onAddStroke={addDiagramStroke}
                  onClearDiagram={clearDamageDiagram}
                  onAppendScene={(fileList, source) => appendDamageDiagramPhotoFiles('scene', fileList, source)}
                  onRemoveScene={(id) => removeDamageDiagramPhoto('scene', id)}
                  onAppendDetail={(fileList, source) => appendDamageDiagramPhotoFiles('detail', fileList, source)}
                  onRemoveDetail={(id) => removeDamageDiagramPhoto('detail', id)}
                />
              </Card>
              <Card title="Damage and towing">
                <div className="grid gap-4">
                  <YesNoField label="Are you claiming for the damage to your vehicle?" value={claim.damage.claimingDamage} onChange={(value) => updateSection('damage', 'claimingDamage', value)} />
                  <YesNoField label="Was the vehicle towed?" value={claim.damage.towed} onChange={(value) => updateSection('damage', 'towed', value)} />
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    If yes, please give details below.
                  </p>
                  <Field
                    label="Name of tow company"
                    value={claim.damage.towCompany}
                    onChange={(value) => updateSection('damage', 'towCompany', value)}
                    disabled={claim.damage.towed !== 'Yes'}
                  />
                  <Field
                    label="Where was it towed?"
                    value={claim.damage.towLocation}
                    onChange={(value) => updateSection('damage', 'towLocation', value)}
                    disabled={claim.damage.towed !== 'Yes'}
                  />
                  <Field
                    label="Distance towed (kms)"
                    value={claim.damage.distanceTowed}
                    onChange={(value) => updateSection('damage', 'distanceTowed', value)}
                    disabled={claim.damage.towed !== 'Yes'}
                  />
                  <Field label="Where is vehicle now?" value={claim.damage.currentVehicleLocation} onChange={(value) => updateSection('damage', 'currentVehicleLocation', value)} />
                </div>
              </Card>
            </div>
            <Card title="Other vehicle details">
              {claim.otherParties.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No other vehicles to capture. If others were involved, go to <span className="font-semibold text-slate-800">Incident Details</span> and set{' '}
                  <span className="font-semibold text-slate-800">How many other vehicles?</span> (e.g. <span className="font-semibold text-slate-800">2</span> for Other Vehicle 1 and Other Vehicle 2 here).
                </p>
              ) : (
                <>
                  <p className="mb-5 text-sm text-slate-600">
                    Complete or edit each block below. The number of sections matches the value you entered on Incident Details.
                  </p>
                  <div className="space-y-5">
                    {claim.otherParties.map((party, index) => (
                      <OtherPartyVehicleCard
                        key={`others-op-${index}`}
                        party={party}
                        index={index}
                        emailError={otherPartyEmailErrors[index]}
                        onFieldChange={(key, value) => updateOtherParty(index, key, value)}
                        onAppendLicenceFiles={(side, files, source) => appendOtherPartyLicenceFiles(index, side, files, source)}
                        onRemoveLicenceFile={(side, id) => removeOtherPartyLicenceFile(index, side, id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </Card>
            <Card title="Witness details">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="font-semibold text-slate-900">Witness 1</p>
                  <Field label="Name" value={claim.witnessDetails.witness1Name} onChange={(value) => updateSection('witnessDetails', 'witness1Name', value)} />
                  <Field label="Address" value={claim.witnessDetails.witness1Address} onChange={(value) => updateSection('witnessDetails', 'witness1Address', value)} />
                  <Field label="Mobile" value={claim.witnessDetails.witness1Mobile} onChange={(value) => updateSection('witnessDetails', 'witness1Mobile', value)} />
                  <Field
                    type="email"
                    label="Email"
                    value={claim.witnessDetails.witness1Email}
                    onChange={(value) => updateSection('witnessDetails', 'witness1Email', value)}
                    error={witness1EmailError}
                    autoComplete="email"
                    inputMode="email"
                  />
                </div>
                <div className="grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="font-semibold text-slate-900">Witness 2</p>
                  <Field label="Name" value={claim.witnessDetails.witness2Name} onChange={(value) => updateSection('witnessDetails', 'witness2Name', value)} />
                  <Field label="Address" value={claim.witnessDetails.witness2Address} onChange={(value) => updateSection('witnessDetails', 'witness2Address', value)} />
                  <Field label="Mobile" value={claim.witnessDetails.witness2Mobile} onChange={(value) => updateSection('witnessDetails', 'witness2Mobile', value)} />
                  <Field
                    type="email"
                    label="Email"
                    value={claim.witnessDetails.witness2Email}
                    onChange={(value) => updateSection('witnessDetails', 'witness2Email', value)}
                    error={witness2EmailError}
                    autoComplete="email"
                    inputMode="email"
                  />
                </div>
              </div>
            </Card>
          </div>
        );
      case 'declaration':
        return (
          <div className="space-y-6">
            <SectionIntro title="Declaration" description="Review the final declaration, choose who is completing it, then sign before submitting." />
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Card title="Disclaimer">
                <div className="space-y-4">
                  <YesNoField
                    label="Do you declare that the details you have provided us are true and correct and not mispresented in anyway?"
                    value={claim.declaration.agreed ? 'Yes' : 'No'}
                    onChange={(value) => updateSection('declaration', 'agreed', value === 'Yes')}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>To be completed by</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <TogglePill active={claim.declaration.signedBy === 'Driver'} label="Driver" onClick={() => updateSection('declaration', 'signedBy', 'Driver')} />
                        <TogglePill active={claim.declaration.signedBy === 'Owner'} label="Owner" onClick={() => updateSection('declaration', 'signedBy', 'Owner')} />
                      </div>
                    </div>
                    <Field type="date" label="Date" value={claim.declaration.date} onChange={(value) => updateSection('declaration', 'date', value)} />
                  </div>
                  <Field label="Print Name" value={claim.declaration.typedName} onChange={(value) => updateSection('declaration', 'typedName', value)} />
                  <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />
                </div>
              </Card>
              <Card title="Submission summary">
                <div className="space-y-4">
                  <SummaryItem label="Checklist Complete" value={`${completedChecklistCount} / ${checklistOptions.length}`} />
                  <SummaryItem label="Vehicle" value={[claim.memberVehicle.plateNumber, claim.memberVehicle.make, claim.memberVehicle.model].filter(Boolean).join(' - ') || 'Not entered'} />
                  <SummaryItem label="Driver" value={joinDriverFullName(claim.driver) || 'Not entered'} />
                  <SummaryItem label="Incident" value={claim.incident.date || 'Not entered'} />
                  <SummaryItem
                    label="Accident scene sketch"
                    value={accidentSketchSummaryForDeclaration(claim.accidentSketch)}
                  />
                  <SummaryItem label="Damage markers placed" value={`${damagePointCount}`} />
                  <SummaryItem label="Other vehicles captured" value={`${claim.otherParties.length}`} />
                </div>
              </Card>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#f7f6f2] pb-nav-safe text-slate-950 xl:pb-8">
      <header className="bg-[#101c18] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-950/20">
              <Shield size={20} aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Horizon Smash Repairs</p>
              <p className="truncate text-xs text-white/60">Accident claim portal</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {draftSavedAt ? (
              <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/75 sm:inline">
                Saved on this device
              </span>
            ) : null}
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold text-amber-100 sm:px-3 sm:text-xs">
              {wizardSteps.length} steps
            </span>
          </div>
        </div>

        <div className="hidden border-t border-white/10 md:block">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Report your accident</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white lg:text-4xl">
                Lodge your claim step by step
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-white/70 lg:text-base">
                Work through each section at your own pace. Your answers are saved automatically on this phone or
                computer so you can pause and come back later.
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.06] p-2 sm:grid-cols-3 lg:max-w-md">
              {completionCards.slice(0, 3).map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2.5">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-white/45">{item.label}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <MobileStepStrip steps={wizardSteps} currentStep={currentStep} onStepChange={setCurrentStep} />

      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        {notice && (
          <div
            className={`mb-4 rounded-xl px-4 py-3.5 shadow-sm sm:px-5 sm:py-4 ${
              notice.type === 'success'
                ? 'border border-emerald-200 bg-emerald-50'
                : 'border border-rose-200 bg-rose-50'
            }`}
            role="status"
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${
                notice.type === 'success' ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {notice.type === 'success' ? 'Done' : 'Please check'}
            </p>
            <p
              className={`mt-1.5 text-sm font-medium ${
                notice.type === 'success' ? 'text-emerald-900' : 'text-rose-900'
              }`}
            >
              {notice.message}
            </p>
          </div>
        )}

        {showResetConfirm && (
          <ConfirmDialog
            title="Start a new claim?"
            description="This clears everything on the form — checklist, incident details, sketches, uploads, and signature. Anything you have not submitted will be lost."
            confirmLabel="Clear form and start over"
            cancelLabel="Keep current form"
            onConfirm={confirmResetWizard}
            onCancel={() => setShowResetConfirm(false)}
          />
        )}

        {showReviewModal && reviewPayload && (
          <ReviewModal
            payload={reviewPayload}
            onClose={() => setShowReviewModal(false)}
            onConfirm={finalizeSubmission}
          />
        )}

        {submissionState.open && (
          <SubmissionStatusModal
            status={submissionState.status}
            referenceCode={submissionState.referenceCode}
            errorMessage={submissionState.errorMessage}
            emailSent={submissionState.emailSent}
            onClose={() =>
              setSubmissionState({ open: false, status: 'idle', referenceCode: null, errorMessage: null, emailSent: null })
            }
            onRetry={() => {
              setSubmissionState({ open: false, status: 'idle', referenceCode: null, errorMessage: null, emailSent: null });
              if (reviewPayload) setShowReviewModal(true);
            }}
            onStartNew={() => {
              setSubmissionState({ open: false, status: 'idle', referenceCode: null, errorMessage: null, emailSent: null });
              setNotice(null);
              completeLocalReset();
            }}
          />
        )}

        <main className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,248px)_1fr] xl:gap-6">
          <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-card xl:col-span-2">
            <button
              type="button"
              onClick={() => setPrefillExpanded((open) => !open)}
              className="flex w-full items-center justify-between gap-3 border-b border-teal-800/10 bg-gradient-to-r from-teal-50/90 to-white px-4 py-3.5 text-left sm:px-5"
              aria-expanded={prefillExpanded}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-800">Returning member?</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">Pre-fill from a previous claim reference</p>
              </div>
              <ChevronDown
                size={20}
                className={`shrink-0 text-slate-500 transition ${prefillExpanded ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {prefillExpanded && (
              <div className="px-4 py-4 sm:px-5 sm:py-5">
                <p className="text-sm leading-relaxed text-slate-600">
                  Enter the <span className="font-semibold text-slate-800">HR-####-####</span> code from your last
                  submission. We will fill in your contact and licence details for this new claim only.
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={resetWizardForm}
                    className="font-semibold text-teal-800 underline decoration-teal-300 underline-offset-2"
                  >
                    Start a fresh claim
                  </button>{' '}
                  without a reference code.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <label htmlFor="prefill-claim-code" className="sr-only">
                    Claim reference from previous submission
                  </label>
                  <input
                    id="prefill-claim-code"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={prefillBusy}
                    placeholder="e.g. HR-A1B2-C3D4"
                    value={prefillCodeInput}
                    onChange={(e) => setPrefillCodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyPrefillFromReference();
                      }
                    }}
                    className="touch-target min-h-[44px] w-full min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={applyPrefillFromReference}
                    disabled={prefillBusy}
                    className="touch-target inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
                  >
                    {prefillBusy ? (
                      <>
                        <LoaderCircle size={16} className="animate-spin" aria-hidden />
                        Loading…
                      </>
                    ) : (
                      'Pre-fill details'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="hidden h-fit rounded-2xl border border-stone-200 bg-white p-4 shadow-card xl:sticky xl:top-6 xl:block">
            <div className="mb-4">
              <p className="text-sm font-semibold text-slate-950">Your progress</p>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-500">Step {currentStep + 1} of {wizardSteps.length}</span>
                <span className="font-semibold text-teal-800">{stepCompletion}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                <div className="h-full rounded-full bg-teal-700 transition-all duration-300" style={{ width: `${stepCompletion}%` }} />
              </div>
            </div>
            <nav className="space-y-1.5" aria-label="Claim steps">
              {wizardSteps.map((step, index) => {
                const Icon = step.icon;
                const active = index === currentStep;
                const done = index < currentStep;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setCurrentStep(index)}
                    aria-current={active ? 'step' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      active
                        ? 'bg-[#101c18] text-white shadow-sm'
                        : done
                          ? 'bg-teal-50 text-teal-900 ring-1 ring-inset ring-teal-100'
                          : 'text-slate-700 hover:bg-stone-50'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                        active
                          ? 'border-white/10 bg-white/10'
                          : done
                            ? 'border-teal-700 bg-teal-700 text-white'
                            : 'border-stone-200 bg-stone-50 text-slate-600'
                      }`}
                    >
                      {done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{step.shortTitle}</p>
                      <p className={`truncate text-xs ${active ? 'text-white/60' : 'text-slate-500'}`}>{step.title}</p>
                    </div>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="min-w-0 space-y-4 pb-2">
            <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-card xl:hidden">
              <div className="border-b border-stone-100 bg-stone-50/40 px-4 py-3.5">
                <h2 className="text-lg font-semibold text-slate-900">{wizardSteps[currentStep].title}</h2>
                <p className="mt-1 text-sm text-slate-600">{wizardSteps[currentStep].description}</p>
              </div>
              <div className="flex gap-2.5 px-4 py-3">
                <HelpCircle size={16} className="mt-0.5 shrink-0 text-teal-600" aria-hidden />
                <p className="text-sm text-slate-600">{wizardSteps[currentStep].tip}</p>
              </div>
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-card xl:block">
              <div className="border-b border-stone-100 bg-stone-50/40 px-5 py-4 sm:px-6">
                <p className="text-xs font-medium uppercase tracking-wide text-teal-700">
                  Step {currentStep + 1} of {wizardSteps.length}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{wizardSteps[currentStep].title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{wizardSteps[currentStep].description}</p>
              </div>
              <div className="flex gap-2.5 px-5 py-3 sm:px-6">
                <HelpCircle size={16} className="mt-0.5 shrink-0 text-teal-600" aria-hidden />
                <p className="text-sm text-slate-600">{wizardSteps[currentStep].tip}</p>
              </div>
            </div>

            <div>{renderStepContent()}</div>

            <WizardFooterNav
              currentStep={currentStep}
              totalSteps={wizardSteps.length}
              onPrevious={() => setCurrentStep((step) => Math.max(step - 1, 0))}
              onNext={() => setCurrentStep((step) => Math.min(step + 1, wizardSteps.length - 1))}
              onPreview={openReview}
              onSubmit={submitClaim}
            />
          </section>
        </main>
      </div>
    </div>
  );
}

function SectionIntro({ title, description }) {
  return (
    <div className="rounded-xl border border-stone-200/80 bg-stone-50/50 px-4 py-3.5">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}

function FormSection({ title, description, children, className = '' }) {
  return (
    <section className={className}>
      {(title || description) && (
        <div className="mb-4">
          {title ? <h5 className="text-sm font-semibold text-slate-900">{title}</h5> : null}
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
      )}
      {children}
    </section>
  );
}

function Card({ title, subtitle, children, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-card ${className}`}>
      {title ? (
        <div className="border-b border-stone-100 bg-stone-50/40 px-5 py-4 sm:px-6">
          <h4 className="text-base font-semibold text-slate-900">{title}</h4>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
      ) : null}
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

function FieldLabel({ children, optional, hint }) {
  return (
    <div className="space-y-0.5">
      <span className="text-sm font-medium text-slate-800">
        {children}
        {optional ? <span className="ml-1.5 text-xs font-normal text-slate-400">(optional)</span> : null}
      </span>
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </div>
  );
}

function Label({ children }) {
  return <span className="text-sm font-medium text-slate-800">{children}</span>;
}

const fieldInputClass =
  'min-h-[44px] w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-slate-400';

function Field({
  label,
  value,
  onChange,
  type = 'text',
  error = '',
  hint = '',
  optional = false,
  placeholder = '',
  autoComplete,
  inputMode,
  disabled = false,
  maxLength,
  className = '',
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <FieldLabel optional={optional} hint={hint}>
        {label}
      </FieldLabel>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={error ? 'true' : 'false'}
        className={`${fieldInputClass} ${
          disabled
            ? 'border-stone-200 bg-stone-50 text-slate-400'
            : error
              ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/15'
              : ''
        }`}
      />
      {!disabled && error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </label>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className={`${fieldInputClass} border-stone-200 bg-stone-50 font-medium text-slate-600`}>{value}</div>
    </div>
  );
}

function TextAreaField({ label, value, onChange, rows = 4 }) {
  return (
    <label className="block space-y-1.5">
      <Label>{label}</Label>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${fieldInputClass} min-h-[88px] resize-y py-3`}
      />
    </label>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="block space-y-1.5">
      <Label>{label}</Label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={fieldInputClass}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TogglePill({ active, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
        disabled ? 'cursor-not-allowed opacity-55' : ''
      } ${
        active
          ? 'border-teal-700 bg-teal-700 text-white shadow-sm'
          : 'border-stone-300 bg-white text-slate-700 hover:border-teal-200 hover:bg-stone-50'
      }`}
    >
      {label}
    </button>
  );
}

function YesNoField({ label, value, onChange, disabled = false }) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-inner shadow-white ${disabled ? 'ring-1 ring-inset ring-stone-200/80' : ''}`}>
      <p className="mb-3 text-sm font-medium text-slate-800">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        {['Yes', 'No'].map((option) => (
          <TogglePill key={option} active={value === option} label={option} onClick={() => onChange(option)} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

function OptionGrid({ options, value, onChange, radioName }) {
  return (
    <div className="grid gap-3">
      {options.map((option) => (
        <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${value === option ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-stone-200 bg-white text-slate-700 hover:border-teal-200 hover:bg-stone-50'}`}>
          <input type="radio" name={radioName} checked={value === option} onChange={() => onChange(option)} className="h-4 w-4 accent-teal-700" />
          <span className="text-sm font-medium">{option}</span>
        </label>
      ))}
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function ConfirmDialog({ title, description, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl ring-1 ring-stone-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-amber-100 bg-gradient-to-br from-amber-50/90 to-white px-6 py-5 sm:px-7">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-900">
              <AlertTriangle size={22} aria-hidden />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-800">Confirm action</p>
              <h3 id="confirm-dialog-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                {title}
              </h3>
            </div>
          </div>
        </div>
        <div className="px-6 py-5 sm:px-7">
          <p className="text-sm leading-relaxed text-slate-600">{description}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-stone-100 bg-stone-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-7">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewModal({ payload, onClose, onConfirm }) {
  const vehicleSummary = [payload.memberVehicle.plateNumber, payload.memberVehicle.make, payload.memberVehicle.model]
    .filter(Boolean)
    .join(' - ') || 'Not entered';
  const diagram = payload.damage.diagram || {};
  const damageMarkers = (diagram.markers || []).length;
  const damageDrawings = (diagram.strokes || []).length;
  const damagePhotos = damagePhotoCountFromState(diagram.scenePhotos || [], diagram.detailPhotos || []);
  const sketch = payload.accidentSketch || {};
  const sketchAttachments = sketch.attachments ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-6 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-800">Review before submit</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Preview your application</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Check the details below. If everything looks correct, confirm submission and the claim will be saved for backend processing.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-6 sm:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryItem label="Claim type" value={payload.memberVehicle.claimType || 'Not entered'} />
            <SummaryItem label="Vehicle" value={vehicleSummary} />
            <SummaryItem label="Driver" value={payload.driver.name || 'Not entered'} />
            <SummaryItem label="Incident date" value={payload.incident.date || 'Not entered'} />
            <SummaryItem
              label="Repair quote ref."
              value={
                payload.checklist?.repairQuote
                  ? payload.repairQuoteRef || 'Not entered'
                  : '—'
              }
            />
            <SummaryItem
              label="Excess amount"
              value={
                payload.checklist?.excessPayment && payload.excessPaymentApplicability === 'Applicable'
                  ? payload.excessPaymentAmount || 'Not entered'
                  : '—'
              }
            />
            <SummaryItem label="Accident sketch" value={accidentSketchSummaryForReview(sketch)} />
            <SummaryItem label="Damage markers" value={`${damageMarkers}`} />
            <SummaryItem label="Damage drawings" value={`${damageDrawings}`} />
            <SummaryItem label="Damage photos" value={`${damagePhotos}`} />
            <SummaryItem label="Other vehicles" value={`${payload.otherParties.length}`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">Member and vehicle</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SummaryItem
                    label="Member number"
                    value={payload.memberVehicle.memberNumber || 'Not provided'}
                  />
                  <SummaryItem label="Owner" value={payload.memberVehicle.ownerName || 'Not entered'} />
                  <SummaryItem label="Mobile" value={payload.memberVehicle.mobile || 'Not entered'} />
                  <SummaryItem label="Email" value={payload.memberVehicle.email || 'Not entered'} />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">Driver</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SummaryItem label="Relationship" value={payload.driver.relationship || 'Not entered'} />
                  <SummaryItem label="Address" value={payload.driver.address || 'Not entered'} />
                  <SummaryItem label="Licence No." value={payload.driver.licenceNumber || 'Not entered'} />
                  <SummaryItem label="Police report no." value={payload.driver.policeReportNumber || 'Not entered'} />
                  <SummaryItem label="At fault" value={payload.driver.atFault || 'Not entered'} />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">Declaration</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SummaryItem label="Completed by" value={payload.declaration.signedBy || 'Not entered'} />
                  <SummaryItem label="Print Name" value={payload.declaration.typedName || 'Not entered'} />
                  <SummaryItem label="Date" value={payload.declaration.date || 'Not entered'} />
                  <SummaryItem label="Signature" value={payload.declaration.signatureDataUrl ? 'Captured' : 'Missing'} />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">Incident</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SummaryItem label="Address detail" value={payload.incident.addressDetailOptional || '—'} />
                  <SummaryItem label="Street" value={payload.incident.streetName || 'Not entered'} />
                  <SummaryItem label="Suburb" value={payload.incident.suburb || 'Not entered'} />
                  <SummaryItem label="Road Surface" value={payload.incident.roadSurface || 'Not entered'} />
                  <SummaryItem label="Traffic controls" value={payload.incident.trafficControls.join(', ') || 'Not entered'} />
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Accident description</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{payload.incident.description || 'Not entered'}</p>
                </div>
                {payload.accidentSketch?.diagramDataUrl ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Accident scene sketch (canvas)</p>
                    <img
                      src={payload.accidentSketch.diagramDataUrl}
                      alt="Accident sketch"
                      className="mt-2 max-h-48 w-full rounded border border-slate-100 object-contain"
                    />
                  </div>
                ) : null}
                {sketchAttachments.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Uploaded sketch file(s)</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {sketchAttachments.map((att, idx) => (
                        <li key={`sketch-att-${idx}-${att.name}`} className="truncate">
                          <span className="font-medium text-slate-900">{att.name}</span>
                          <span className="ml-2 text-xs text-slate-500">({att.source === 'camera' ? 'Camera' : 'Upload'})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">Damage and towing</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SummaryItem label="Claiming damage" value={payload.damage.claimingDamage || 'Not entered'} />
                  <SummaryItem label="Vehicle towed" value={payload.damage.towed || 'Not entered'} />
                  <SummaryItem label="Tow company" value={payload.damage.towCompany || 'Not entered'} />
                  <SummaryItem label="Vehicle location" value={payload.damage.currentVehicleLocation || 'Not entered'} />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">Other parties and witnesses</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SummaryItem label="Other vehicles" value={`${payload.otherParties.length}`} />
                  <SummaryItem label="Witnesses" value={`${payload.witnessDetails.length}`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:justify-end sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Edit details
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-800"
          >
            Confirm and submit
          </button>
        </div>
      </div>
    </div>
  );
}

function SubmissionStatusModal({ status, referenceCode, errorMessage, emailSent, onClose, onRetry, onStartNew }) {
  if (status === 'pending') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
        <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
          <div className="px-6 py-8 text-center sm:px-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-teal-700 text-white shadow-lg shadow-teal-100">
              <LoaderCircle size={28} className="animate-spin" />
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-teal-800">Submitting application</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Please wait a moment</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              We are sending your claim now. This usually takes a few seconds — please keep this page open.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
        <div className="w-full max-w-xl overflow-hidden rounded-lg border border-rose-200 bg-white shadow-2xl">
          <div className="bg-rose-50 px-6 py-6 sm:px-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-rose-600 text-white shadow-lg shadow-rose-100">
                  <AlertTriangle size={26} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">Submission failed</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">We could not submit the claim</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                    Please review your details and try again.
                    {errorMessage ? ' The message below may help explain what went wrong.' : ''}
                  </p>
                  {errorMessage ? (
                    <p className="mt-3 max-w-xl whitespace-pre-wrap break-words rounded-md border border-rose-100 bg-white/90 px-3 py-2 font-mono text-xs leading-snug text-rose-950">
                      {errorMessage}
                    </p>
                  ) : null}
                </div>
              </div>
              <button type="button" onClick={onClose} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:justify-end sm:px-8">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              Edit details
            </button>
            <button type="button" onClick={onRetry} className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              Retry submission
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-2xl">
        <div className="bg-emerald-50 px-6 py-6 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-lg shadow-emerald-100">
                <CheckCircle2 size={26} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Application submitted</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Claim submitted successfully</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                  Thank you — we have received your claim. Our team will review it and contact you if we need anything else.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>

        {emailSent === false ? (
          <div className="border-t border-amber-100 bg-amber-50 px-6 py-4 sm:px-8">
            <p className="text-sm font-medium text-amber-950">
              Your claim was saved, but the confirmation email could not be sent. Check the API server email settings in Render.
            </p>
          </div>
        ) : null}

        {referenceCode ? (
          <div className="border-t border-emerald-100 bg-white px-6 py-5 sm:px-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Your claim reference (save this)</p>
            <p className="mt-1 text-sm text-slate-600">
              Save this code for your records. On a future visit, enter it at the top of the claim form to pre-fill your contact and licence details for a new claim.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-base font-bold tracking-[0.12em] text-slate-900 sm:text-lg">
                {referenceCode}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!referenceCode) return;
                  navigator.clipboard?.writeText(referenceCode).catch(() => {});
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <Copy size={14} aria-hidden />
                Copy code
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 border-t border-slate-100 px-6 py-6 sm:grid-cols-3 sm:px-8">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</p>
            <p className="mt-2 text-base font-semibold text-slate-950">Received</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Submission</p>
            <p className="mt-2 text-base font-semibold text-slate-950">Complete</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Next step</p>
            <p className="mt-2 text-base font-semibold text-slate-950">Admin review</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:justify-end sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Stay here
          </button>
          <button
            type="button"
            onClick={onStartNew}
            className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Start new claim
          </button>
        </div>
      </div>
    </div>
  );
}

function SketchVehiclePhoto({ role = 'self', mirror = false, className = 'h-full w-full object-contain' }) {
  const src = role === 'self' ? SKETCH_CAR_SELF_SRC : SKETCH_CAR_OTHER_SRC;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={`select-none ${className}`}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

function SketchCarPreview({ role = 'self', label, accent = 'self' }) {
  const accentClasses = accent === 'self'
    ? 'border-red-200 bg-red-50/60'
    : 'border-orange-200 bg-orange-50/60';
  return (
    <span
      className={`inline-flex items-center gap-3 rounded-xl border px-3 py-2.5 ${accentClasses}`}
      aria-hidden
      title={`${label} symbol`}
    >
      <span className="flex h-11 w-[5.25rem] items-center justify-center rounded-lg border border-white/90 bg-transparent shadow-sm">
        <SketchVehiclePhoto role={role} className="h-9 w-full object-contain" />
      </span>
      <span className="text-xs font-semibold text-slate-700">{label}</span>
    </span>
  );
}

function SketchVehicleGlyph({ role = 'self', mirror = false, className = 'h-full w-full' }) {
  const palette = SKETCH_VEHICLE_PALETTE[role === 'self' ? 'self' : 'other'];
  const gradId = useId();
  return (
    <svg
      viewBox="-66 -30 132 60"
      className={className}
      aria-hidden
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="-26" x2="0" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={palette.bodyTop} />
          <stop offset="1" stopColor={palette.bodyBottom} />
        </linearGradient>
      </defs>
      <ellipse cx="0" cy="30" rx="52" ry="4.5" fill="#0f172a" opacity="0.08" />
      <path
        fill={`url(#${gradId})`}
        stroke={palette.stroke}
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M 62 0 C 66 -5 65.5 -14 58 -21 C 52 -25 46 -26 38 -26 L 22 -26 C 12 -27 4 -27 -6 -26.5 C -18 -26 -28 -26 -38 -24.5 C -50 -23 -58 -18 -63 -10 C -66 -4 -66 4 -63 10 C -58 18 -50 23 -38 24.5 C -28 26 -18 26 -6 26.5 C 4 27 12 27 22 26 L 38 26 C 46 26 52 25 58 21 C 65.5 14 66 5 62 0 Z"
      />
      <path fill={palette.glass} fillOpacity={palette.glassOpacity} d="M 14 -18 L 28 -20 L 36 -16 L 36 16 L 28 20 L 14 18 Z" />
      <path fill={palette.glass} fillOpacity={palette.glassOpacity * 0.92} d="M 42 -19 L 54 -20 L 58 -16 L 58 16 L 54 20 L 42 19 Z" />
      <rect x="-20" y="-3" width="72" height="6" fill="#fff" opacity="0.12" />
      <ellipse cx="34" cy="-27" rx="6.5" ry="4.2" fill={palette.wheel} />
      <ellipse cx="34" cy="27" rx="6.5" ry="4.2" fill={palette.wheel} />
      <ellipse cx="-34" cy="-27" rx="6.5" ry="4.2" fill={palette.wheel} />
      <ellipse cx="-34" cy="27" rx="6.5" ry="4.2" fill={palette.wheel} />
      <ellipse cx="34" cy="-27" rx="2.8" ry="1.8" fill={palette.hub} />
      <ellipse cx="34" cy="27" rx="2.8" ry="1.8" fill={palette.hub} />
      <ellipse cx="-34" cy="-27" rx="2.8" ry="1.8" fill={palette.hub} />
      <ellipse cx="-34" cy="27" rx="2.8" ry="1.8" fill={palette.hub} />
      <ellipse cx="20" cy="-28" rx="3.2" ry="1.8" fill={palette.mirror} transform="rotate(11 20 -28)" />
      <ellipse cx="20" cy="28" rx="3.2" ry="1.8" fill={palette.mirror} transform="rotate(-11 20 28)" />
      <ellipse cx="59" cy="-14" rx="3.5" ry="2.2" fill={palette.headlight} transform="rotate(17 59 -14)" />
      <ellipse cx="59" cy="14" rx="3.5" ry="2.2" fill={palette.headlight} transform="rotate(-17 59 14)" />
      <ellipse cx="-61" cy="-12" rx="2.8" ry="2" fill={palette.taillight} />
      <ellipse cx="-61" cy="12" rx="2.8" ry="2" fill={palette.taillight} />
    </svg>
  );
}

function AccidentSketchCanvas({ sketchModel, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const modelRef = useRef(normalizeSketchModel(sketchModel));
  const labelInputRef = useRef(null);
  const dragRef = useRef(null);
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [mode, setMode] = useState('draw'); // draw | self-car | other-car | label | select
  const [selected, setSelected] = useState(null); // { type: 'vehicle' | 'label', id: string }
  const [labelDraft, setLabelDraft] = useState(null); // { x, y, editId?: string }
  const [labelInput, setLabelInput] = useState('');
  const [historyTick, setHistoryTick] = useState(0);
  const [carStampImages, setCarStampImages] = useState({ self: null, other: null });

  useEffect(() => {
    let cancelled = false;
    const load = (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    Promise.all([load(SKETCH_CAR_SELF_SRC), load(SKETCH_CAR_OTHER_SRC)]).then(([self, other]) => {
      if (!cancelled) setCarStampImages({ self, other });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    modelRef.current = normalizeSketchModel(sketchModel);
  }, [sketchModel]);

  useEffect(() => {
    if (mode !== 'label') {
      setLabelDraft(null);
      setLabelInput('');
    }
  }, [mode]);

  useEffect(() => {
    if (!labelDraft) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setLabelDraft(null);
        setLabelInput('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [labelDraft]);

  useEffect(() => {
    if (!labelDraft) return undefined;
    const id = requestAnimationFrame(() => labelInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [labelDraft]);

  const normalized = normalizeSketchModel(sketchModel);
  const hasSketch = useMemo(
    () =>
      normalized.lines.some((line) => line.points && line.points.length >= 2) ||
      normalized.vehicles.length > 0 ||
      normalized.labels.length > 0,
    [sketchModel]
  );
  const selectedVehicleId = selected?.type === 'vehicle' ? selected.id : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    redrawAccidentSketch(canvas, sketchModel, carStampImages, selectedVehicleId);
  }, [sketchModel, carStampImages, selectedVehicleId]);

  const cloneModel = (m) => JSON.parse(JSON.stringify(normalizeSketchModel(m)));

  const emit = (next) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const clean = normalizeSketchModel(next);
    modelRef.current = clean;
    redrawAccidentSketch(canvas, clean, carStampImages, selected?.type === 'vehicle' ? selected.id : null);
    onChange({
      diagramDataUrl: canvas.toDataURL('image/png'),
      sketchModel: clean,
    });
  };

  const pushHistory = () => {
    pastRef.current.push(cloneModel(modelRef.current));
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  };

  const rotateSelectedVehicle = (deltaRad) => {
    if (!selected || selected.type !== 'vehicle') return;
    pushHistory();
    const cur = modelRef.current;
    const vid = selected.id;
    emit({
      ...cur,
      vehicles: cur.vehicles.map((v) =>
        v.id === vid ? { ...v, angle: (v.angle ?? 0) + deltaRad } : v
      ),
    });
  };

  /** Horizontal flip (mirror along X after rotation) — face the opposite way without changing angle. */
  const flipSelectedVehicleX = () => {
    if (!selected || selected.type !== 'vehicle') return;
    pushHistory();
    const cur = modelRef.current;
    const vid = selected.id;
    emit({
      ...cur,
      vehicles: cur.vehicles.map((v) =>
        v.id === vid ? { ...v, flipX: !v.flipX } : v
      ),
    });
  };

  const sketchRotationStep = (shiftKey) =>
    shiftKey ? SKETCH_VEHICLE_ROTATE_STEP_FINE : SKETCH_VEHICLE_ROTATE_STEP;

  useEffect(() => {
    if (mode !== 'select' || selected?.type !== 'vehicle') return undefined;
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === '[') {
        e.preventDefault();
        rotateSelectedVehicle(-sketchRotationStep(e.shiftKey));
      } else if (e.key === ']') {
        e.preventDefault();
        rotateSelectedVehicle(sketchRotationStep(e.shiftKey));
      } else if (e.key === 'x' || e.key === 'X') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        flipSelectedVehicleX();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, selected?.type, selected?.id]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  const undo = () => {
    if (!canUndo) return;
    const current = cloneModel(modelRef.current);
    const prev = pastRef.current.pop();
    futureRef.current.push(current);
    setSelected(null);
    emit(prev);
    setHistoryTick((t) => t + 1);
  };

  const redo = () => {
    if (!canRedo) return;
    const current = cloneModel(modelRef.current);
    const next = futureRef.current.pop();
    pastRef.current.push(current);
    setSelected(null);
    emit(next);
    setHistoryTick((t) => t + 1);
  };

  const cancelLabelDraft = () => {
    setLabelDraft(null);
    setLabelInput('');
  };

  const confirmLabel = () => {
    const text = labelInput.trim();
    if (!text || !labelDraft) return;
    const cur = modelRef.current;
    pushHistory();
    if (labelDraft.editId) {
      emit({
        ...cur,
        labels: cur.labels.map((lb) => (lb.id === labelDraft.editId ? { ...lb, text } : lb)),
      });
    } else {
      emit({
        ...cur,
        labels: [...cur.labels, { id: makeSketchId('lbl'), text, x: labelDraft.x, y: labelDraft.y }],
      });
    }
    cancelLabelDraft();
  };

  const beginEditSelectedLabel = () => {
    if (!selected || selected.type !== 'label') return;
    const cur = modelRef.current;
    const lb = cur.labels.find((l) => l.id === selected.id);
    if (!lb) return;
    setMode('label');
    setLabelDraft({ x: lb.x, y: lb.y, editId: lb.id });
    setLabelInput(lb.text || '');
  };

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const hitTest = (point) => {
    const cur = modelRef.current;
    // Vehicles: centered at x/y with known body size.
    for (let i = cur.vehicles.length - 1; i >= 0; i--) {
      const v = cur.vehicles[i];
      if (sketchPointInVehicleBody(point.x, point.y, v)) {
        return { type: 'vehicle', id: v.id, anchor: { x: v.x, y: v.y } };
      }
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    for (let i = cur.labels.length - 1; i >= 0; i--) {
      const lb = cur.labels[i];
      const text = lb.text || '';
      if (!text) continue;
      let textWidth = (text.length || 1) * (SKETCH_LABEL_FONT_PX * 0.62);
      if (ctx) {
        ctx.save();
        ctx.font = `600 ${SKETCH_LABEL_FONT_PX}px Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
        textWidth = ctx.measureText(text).width;
        ctx.restore();
      }
      const padX = 14;
      const padY = 10;
      const boxW = textWidth + padX * 2;
      const boxH = Math.ceil(SKETCH_LABEL_FONT_PX * 1.25) + padY * 2;
      if (point.x >= lb.x && point.x <= lb.x + boxW && point.y >= lb.y && point.y <= lb.y + boxH) {
        return { type: 'label', id: lb.id, anchor: { x: lb.x, y: lb.y } };
      }
    }

    return null;
  };

  const moveSelectedBy = (idType, dx, dy) => {
    const cur = modelRef.current;
    if (idType.type === 'vehicle') {
      emit({
        ...cur,
        vehicles: cur.vehicles.map((v) => (v.id === idType.id ? { ...v, x: v.x + dx, y: v.y + dy } : v)),
      });
      return;
    }
    if (idType.type === 'label') {
      emit({
        ...cur,
        labels: cur.labels.map((lb) => (lb.id === idType.id ? { ...lb, x: lb.x + dx, y: lb.y + dy } : lb)),
      });
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    pushHistory();
    const cur = modelRef.current;
    if (selected.type === 'vehicle') {
      emit({ ...cur, vehicles: cur.vehicles.filter((v) => v.id !== selected.id) });
    } else {
      emit({ ...cur, labels: cur.labels.filter((l) => l.id !== selected.id) });
    }
    setSelected(null);
  };

  const removeLastStroke = () => {
    const cur = modelRef.current;
    if (!cur.lines.length) return;
    pushHistory();
    emit({ ...cur, lines: cur.lines.slice(0, -1) });
  };

  const handlePointerDown = (event) => {
    if (mode === 'select') {
      event.preventDefault();
      const p = getPoint(event);
      const hit = hitTest(p);
      if (!hit) {
        setSelected(null);
        return;
      }
      setSelected({ type: hit.type, id: hit.id });
      // Start dragging.
      pushHistory();
      dragRef.current = { type: hit.type, id: hit.id, last: p };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    if (mode === 'label') {
      event.preventDefault();
      const p = getPoint(event);
      const hit = hitTest(p);
      if (hit?.type === 'label') {
        const cur = modelRef.current;
        const lb = cur.labels.find((l) => l.id === hit.id);
        if (lb) {
          setLabelDraft({ x: lb.x, y: lb.y, editId: lb.id });
          setLabelInput(lb.text || '');
          setSelected({ type: 'label', id: lb.id });
          return;
        }
      }
      setSelected(null);
      setLabelDraft({ x: p.x, y: p.y });
      setLabelInput('');
      return;
    }

    if (mode !== 'draw') {
      event.preventDefault();
      const p = getPoint(event);
      const role = mode.startsWith('self') ? 'self' : 'other';
      const shape = mode.endsWith('car') ? 'car' : 'rect';
      const cur = modelRef.current;
      pushHistory();
      setSelected(null);
      emit({
        ...cur,
        vehicles: [...cur.vehicles, {
          id: makeSketchId('veh'),
          role,
          shape,
          x: p.x,
          y: p.y,
          angle: 0,
        }],
      });
      return;
    }

    drawingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const cur = modelRef.current;
    pushHistory();
    setSelected(null);
    emit({
      ...cur,
      lines: [...cur.lines, { points: [getPoint(event)] }],
    });
  };

  const handlePointerMove = (event) => {
    if (mode === 'select' && dragRef.current) {
      const p = getPoint(event);
      const last = dragRef.current.last;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      dragRef.current.last = p;
      moveSelectedBy({ type: dragRef.current.type, id: dragRef.current.id }, dx, dy);
      return;
    }
    if (!drawingRef.current || mode !== 'draw') return;
    const p = getPoint(event);
    const cur = modelRef.current;
    const lines = [...cur.lines];
    const idx = lines.length - 1;
    if (idx < 0) return;
    const last = lines[idx];
    lines[idx] = { points: [...last.points, p] };
    emit({ ...cur, lines });
  };

  const handlePointerUp = (event) => {
    if (event?.currentTarget != null && event.pointerId != null) {
      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* ignore */
      }
    }
    drawingRef.current = false;
    dragRef.current = null;
  };

  const clear = () => {
    drawingRef.current = false;
    setMode('draw');
    cancelLabelDraft();
    setSelected(null);
    pushHistory();
    emit(emptySketchModel());
  };

  const canvasCursor =
    mode === 'draw'
      ? 'cursor-crosshair'
      : mode === 'label'
        ? 'cursor-text'
        : mode === 'select'
          ? 'cursor-default'
          : 'cursor-copy';

  const modeButton = (id, label, Icon) => (
    <button
      key={id}
      type="button"
      onClick={() => setMode(id)}
      className={`inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold leading-tight shadow-sm transition sm:min-h-[2.75rem] sm:gap-2 sm:px-3.5 sm:text-xs ${
        mode === id
          ? 'border-teal-800 bg-teal-700 text-white shadow-md ring-2 ring-teal-600/30'
          : 'border-slate-200 bg-white text-slate-800 hover:border-teal-300 hover:bg-teal-50/60'
      }`}
    >
      <Icon size={16} className="shrink-0 opacity-95" aria-hidden />
      {label}
    </button>
  );

  const modeButtonVehicle = (id, label, role) => (
    <button
      key={id}
      type="button"
      onClick={() => setMode(id)}
      className={`inline-flex min-h-[2.5rem] items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] font-semibold leading-tight shadow-sm transition sm:min-h-[2.75rem] sm:px-3 sm:text-xs ${
        mode === id
          ? 'border-teal-800 bg-teal-700 text-white shadow-md ring-2 ring-teal-600/30'
          : 'border-slate-200 bg-white text-slate-800 hover:border-teal-300 hover:bg-teal-50/60'
      }`}
    >
      <span className={`flex h-8 w-12 shrink-0 items-center justify-center rounded-lg border bg-transparent ${
        mode === id ? 'border-white/25' : 'border-slate-200/80'
      }`}>
        <SketchVehiclePhoto role={role} className="h-7 w-full object-contain" />
      </span>
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{role === 'self' ? 'Yours' : 'Other'}</span>
    </button>
  );

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-b from-white to-slate-50/90 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/80 ${
        hasSketch ? 'border-emerald-300/80' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/90 bg-slate-100/80 px-4 py-3">
        <span
          className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${
            hasSketch ? 'text-emerald-800' : 'text-slate-500'
          }`}
        >
          {hasSketch ? 'Sketch captured' : 'Draw below'}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300/90 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            title="Undo"
          >
            <Undo2 size={16} />
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300/90 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            title="Redo"
          >
            <Redo2 size={16} />
            Redo
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-xl border border-slate-300/90 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {modeButton('select', 'Select', MousePointer2)}
          {modeButton('draw', 'Draw', PenLine)}
          {modeButton('label', 'Text', Type)}
        </div>
        <div className="hidden h-7 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5">
          {modeButtonVehicle('self-car', 'Your vehicle', 'self')}
          {modeButtonVehicle('other-car', 'Other vehicle', 'other')}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={removeLastStroke}
            disabled={!modelRef.current.lines.length}
            className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/60 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:min-h-[2.75rem] sm:text-xs"
            title="Remove last stroke"
          >
            <Undo2 size={16} />
            Last stroke
          </button>
          {selected ? (
            <>
              {selected.type === 'label' ? (
                <button
                  type="button"
                  onClick={beginEditSelectedLabel}
                  className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/60 sm:min-h-[2.75rem] sm:text-xs"
                >
                  <Type size={16} />
                  Edit text
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => flipSelectedVehicleX()}
                    className="inline-flex min-h-[2.5rem] items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/60 sm:min-h-[2.75rem] sm:px-3 sm:text-xs"
                    title="Flip horizontally — face the other way (X)"
                  >
                    <FlipHorizontal size={16} />
                    <span className="hidden sm:inline">Flip</span>
                  </button>
                  <button
                    type="button"
                    onClick={(ev) => rotateSelectedVehicle(-sketchRotationStep(ev.shiftKey))}
                    className="inline-flex min-h-[2.5rem] items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/60 sm:min-h-[2.75rem] sm:px-3 sm:text-xs"
                    title="Rotate left: 15° (hold Shift: 5°). Shortcut ["
                  >
                    <RotateCcw size={16} />
                    <span className="hidden sm:inline">Turn</span>
                  </button>
                  <button
                    type="button"
                    onClick={(ev) => rotateSelectedVehicle(sketchRotationStep(ev.shiftKey))}
                    className="inline-flex min-h-[2.5rem] items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/60 sm:min-h-[2.75rem] sm:px-3 sm:text-xs"
                    title="Rotate right: 15° (hold Shift: 5°). Shortcut ]"
                  >
                    <RotateCw size={16} />
                    <span className="hidden sm:inline">Turn</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={deleteSelected}
                className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 sm:min-h-[2.75rem] sm:text-xs"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>
      {mode === 'label' ? (
        <div className="border-b border-slate-100 bg-white px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-900">Text</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                {labelDraft
                  ? labelDraft.editId
                    ? 'Editing label. Click another label to edit, or click on the sketch to place a new one.'
                    : 'Click on the sketch to position the text, then type below.'
                  : 'Click on the sketch to position the text, then type below.'}
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  ref={labelInputRef}
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      confirmLabel();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelLabelDraft();
                    }
                  }}
                  placeholder="Type anything…"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25 sm:max-w-[520px]"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={cancelLabelDraft}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={confirmLabel}
                    disabled={!labelInput.trim() || !labelDraft}
                    className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    {labelDraft?.editId ? 'Save' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 sm:text-right">
              <span className="font-semibold text-slate-700">Tip:</span> Select mode lets you drag labels after placing.
            </div>
          </div>
        </div>
      ) : null}
      <p className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs leading-snug text-slate-600">
        {mode === 'select' &&
          (selected
            ? selected.type === 'vehicle'
              ? 'Drag to move. Turn (15°, Shift for 5°). Flip mirrors direction. Delete removes.'
              : 'Drag the label to move it. Use Delete to remove.'
            : 'Tap a vehicle or label to select it, then drag to reposition.')}
        {mode === 'draw' && 'Drag to draw roads, lanes, and direction arrows.'}
        {mode.startsWith('self') && mode !== 'select' && 'Tap the map to place your vehicle, then rotate it to match the road direction.'}
        {mode.startsWith('other') && mode !== 'label' && mode !== 'select' && 'Tap the map to place the other vehicle — it faces the opposite way by default.'}
        {mode === 'label' && (labelDraft ? 'Type label text above, then Add label.' : 'Click the sketch to choose where the label goes.')}
      </p>
      <div className="relative bg-[radial-gradient(circle_at_50%_0%,rgba(148,163,184,0.12),transparent_55%)] p-3 sm:p-4">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_2px_8px_rgba(15,23,42,0.04)]">
          <canvas
            ref={canvasRef}
            width={SKETCH_CANVAS_WIDTH}
            height={SKETCH_CANVAS_HEIGHT}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className={`touch-none h-auto max-h-[min(62vh,580px)] w-full bg-transparent ${canvasCursor}`}
          />
        </div>
      </div>
    </div>
  );
}

function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const skipValueSyncRef = useRef(false);
  const hasSignature = Boolean(value);

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const prepareStroke = (ctx) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
  };

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    prepareStroke(ctx);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, rect.width, rect.height);
  };

  const exportSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    skipValueSyncRef.current = true;
    onChange(canvas.toDataURL('image/png'));
  };

  useLayoutEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, []);

  useLayoutEffect(() => {
    if (skipValueSyncRef.current) {
      skipValueSyncRef.current = false;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!value) {
      clearCanvas();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawImage(image, 0, 0, rect.width, rect.height);
    };
    image.src = value;
  }, [value]);

  const startDrawing = (event) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    prepareStroke(ctx);
    const point = getPoint(event);
    lastPointRef.current = point;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const draw = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    prepareStroke(ctx);
    const point = getPoint(event);
    const last = lastPointRef.current;

    if (last) {
      const midX = (last.x + point.x) / 2;
      const midY = (last.y + point.y) / 2;
      ctx.quadraticCurveTo(last.x, last.y, midX, midY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(midX, midY);
    } else {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }

    lastPointRef.current = point;
  };

  const stopDrawing = (event) => {
    if (!drawingRef.current) return;
    event?.preventDefault?.();

    const canvas = canvasRef.current;
    if (canvas && event?.pointerId != null) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released.
      }
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    exportSignature();
  };

  const clear = () => {
    clearCanvas();
    skipValueSyncRef.current = true;
    onChange('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <PenLine className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-950">Your signature</p>
            <p className="text-xs text-slate-500">Use your finger or mouse on the line below</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            hasSignature ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {hasSignature ? 'Signed' : 'Required'}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={!hasSignature}
            className="touch-target rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      <div className={`relative overflow-hidden rounded-xl border-2 bg-white transition-colors ${
        hasSignature ? 'border-emerald-200' : 'border-slate-200'
      }`}>
        <div className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-slate-300" />
        <div className="pointer-events-none absolute bottom-3 left-6 flex items-center gap-1.5 text-xs text-slate-400">
          <PencilLine className="h-3.5 w-3.5" aria-hidden />
          Sign on the line
        </div>
        <canvas
          ref={canvasRef}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
          onPointerCancel={stopDrawing}
          className="relative block h-36 w-full touch-none select-none rounded-xl bg-white sm:h-40"
          style={{ touchAction: 'none' }}
          aria-label="Signature pad"
        />
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Your signature confirms the information you have provided is true and correct.
      </p>
    </div>
  );
}

function CompositeDamageMap({
  diagramSrc,
  markers,
  strokes,
  sceneAttachments,
  detailAttachments,
  onAddMarker,
  onAddStroke,
  onClearDiagram,
  onAppendScene,
  onRemoveScene,
  onAppendDetail,
  onRemoveDetail,
}) {
  const [interactionMode, setInteractionMode] = useState('mark');
  const drawBufferRef = useRef([]);
  const isDrawingRef = useRef(false);

  const totalMarkers = markers.length;
  const totalStrokes = strokes.length;
  const totalPhotos = damagePhotoCountFromState(sceneAttachments, detailAttachments);

  const toPercent = (clientX, clientY, el) => {
    const b = el.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((clientX - b.left) / b.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - b.top) / b.height) * 100)),
    };
  };

  const handleMarkClick = (event) => {
    if (interactionMode !== 'mark') return;
    const { x, y } = toPercent(event.clientX, event.clientY, event.currentTarget);
    onAddMarker({ x, y });
  };

  const handleDrawPointerDown = (event) => {
    if (interactionMode !== 'draw') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    drawBufferRef.current = [toPercent(event.clientX, event.clientY, event.currentTarget)];
  };

  const handleDrawPointerMove = (event) => {
    if (!isDrawingRef.current || interactionMode !== 'draw') return;
    const p = toPercent(event.clientX, event.clientY, event.currentTarget);
    const prev = drawBufferRef.current[drawBufferRef.current.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.35) {
      drawBufferRef.current.push(p);
    }
  };

  const handleDrawPointerUp = (event) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const pts = drawBufferRef.current;
    drawBufferRef.current = [];
    if (pts.length > 1) {
      onAddStroke(pts);
    }
  };

  const photoBits = [];
  if (sceneAttachments.length) photoBits.push(`${sceneAttachments.length} overview`);
  if (detailAttachments.length) photoBits.push(`${detailAttachments.length} close-up`);
  const photoSuffix = photoBits.length ? ` · ${photoBits.join(', ')}` : '';

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-50 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-md border border-teal-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-800">
                <AlertTriangle size={12} />
                Damage Assessment
              </div>
              <h4 className="mt-3 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">Mark damage on your vehicle</h4>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Tap to place markers where your vehicle was damaged, or switch to draw mode to circle affected areas.
                Add overview and close-up photos if you have them.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Markers</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{totalMarkers}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Drawings</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{totalStrokes}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Photos</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{totalPhotos}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-slate-950">Interactive diagram</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              {totalMarkers} marker{totalMarkers === 1 ? '' : 's'}
              {totalStrokes > 0 ? ` · ${totalStrokes} drawing${totalStrokes === 1 ? '' : 's'}` : ''}
              {photoSuffix}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setInteractionMode('mark')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                  interactionMode === 'mark' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MapPin size={14} className="shrink-0" aria-hidden />
                Mark
              </button>
              <button
                type="button"
                onClick={() => setInteractionMode('draw')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                  interactionMode === 'draw' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PenLine size={14} className="shrink-0" aria-hidden />
                Draw
              </button>
            </div>
            <button
              type="button"
              onClick={onClearDiagram}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <div className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white">
            <img
              src={diagramSrc}
              alt="Vehicle diagram for damage marking"
              className="pointer-events-none block h-auto max-h-[min(72vh,720px)] w-full object-contain select-none"
              draggable={false}
            />
            <div
              role="application"
              aria-label="Damage diagram"
              onClick={handleMarkClick}
              onPointerDown={handleDrawPointerDown}
              onPointerMove={handleDrawPointerMove}
              onPointerUp={handleDrawPointerUp}
              onPointerCancel={handleDrawPointerUp}
              className="absolute inset-0 touch-none select-none cursor-crosshair"
            >
              <svg viewBox="0 0 100 100" className="pointer-events-none h-full w-full" preserveAspectRatio="none">
                {strokes.map((stroke) => (
                  <polyline
                    key={stroke.id}
                    fill="none"
                    stroke="#b91c1c"
                    strokeWidth="0.85"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={stroke.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                  />
                ))}
                {markers.map((point, index) => (
                  <g key={`${point.x}-${point.y}-${index}`} transform={`translate(${point.x},${point.y})`}>
                    <circle r="2.35" fill="rgba(255,255,255,0.95)" stroke="#fecaca" strokeWidth="0.4" />
                    <line x1="-1.5" y1="-1.5" x2="1.5" y2="1.5" stroke="#dc2626" strokeWidth="0.5" strokeLinecap="round" />
                    <line x1="1.5" y1="-1.5" x2="-1.5" y2="1.5" stroke="#dc2626" strokeWidth="0.5" strokeLinecap="round" />
                  </g>
                ))}
              </svg>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            {interactionMode === 'mark'
              ? 'Tap on the outline where the vehicle was damaged.'
              : 'Click and drag on the diagram to outline the damaged area.'}
          </p>
          <DamageViewDualPhotoPanel
            sceneAttachments={sceneAttachments}
            detailAttachments={detailAttachments}
            onAppendScene={onAppendScene}
            onRemoveScene={onRemoveScene}
            onAppendDetail={onAppendDetail}
            onRemoveDetail={onRemoveDetail}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
