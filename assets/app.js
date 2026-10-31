(() => {
  "use strict";

  const stage = document.getElementById("globe-stage");
  const canvas = document.getElementById("globe");
  const context = canvas.getContext("2d");
  const status = document.getElementById("globe-status");
  const hoverLabel = document.getElementById("globe-hover");
  const cityLabel = document.getElementById("city-label");
  const select = document.getElementById("country-select");
  const card = document.getElementById("country-card");
  const cardTitle = document.getElementById("card-title");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = window.matchMedia("(max-width: 42rem)");

  const MAX_ZOOM = 48;
  const degrees = 180 / Math.PI;
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
  const backProjection = d3.geoOrthographic().clipAngle(90).precision(0.8).reflectX(true);
  const path = d3.geoPath(projection, context);
  const sphere = { type: "Sphere" };
  const graticule = d3.geoGraticule10();

  // Open the globe on the reader's side of the world, from the time zone alone.
  const homeLongitude = Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
  const home = { lambda: -homeLongitude, phi: -22, zoom: 1 };
  const view = { ...home, cx: 0, cy: 0 };

  let size = { width: 0, height: 0, ratio: 1, radius: 0 };
  let regions = {};
  let organizations = {};
  let shapes = new Map();
  let pickOrder = [];
  let land = null;
  let lines = {};
  let coarse = null;
  let lakeShapes = { map: null, byRegion: new Map() };
  let riverShapes = new Map();
  let riverPath = null;
  let marks = [];
  let pointedMark = null;
  let moving = false;
  let settleTimer = 0;
  let colors = {};
  let hovered = null;
  let selected = null;
  let activeCity = -1;
  let animation = null;
  let frame = 0;
  let returnFocus = null;

  /* Colors come from the shared theme tokens, so the globe follows the color mode. */
  function readColors() {
    const style = getComputedStyle(document.documentElement);
    const token = name => style.getPropertyValue(name).trim();
    const dark = document.documentElement.dataset.theme === "dark";
    colors = {
      water: token("--globe-water"),
      land: token("--globe-land"),
      border: token("--globe-border"),
      coast: token("--globe-coast"),
      grid: token("--globe-grid"),
      limb: token("--globe-limb"),
      outline: token("--line-strong"),
      ink: token("--ink"),
      paper: token("--paper"),
      blue: token("--blue"),
      selection: mix(token("--blue"), dark ? 0.34 : 0.22),
      lake: mix(token("--blue"), dark ? 0.8 : 0.62),
      sans: token("--sans"),
      hover: mix(token("--ink"), dark ? 0.12 : 0.07),
      back: mix(token("--ink"), dark ? 0.22 : 0.17),
      backLand: mix(token("--ink"), dark ? 0.045 : 0.03),
    };
  }

  function mix(hex, alpha) {
    const value = hex.replace("#", "");
    const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /* Layout: on a wide screen the open card is a column at the right of the stage, and the
     canvas fills the rest. On a narrow screen the card is a sheet over the lower half. */
  function measure() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    size = { width: rect.width, height: rect.height, ratio, radius: Math.max(60, Math.min(rect.width, rect.height) / 2 - 14) };
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const target = centre();
    view.cx = target.cx;
    view.cy = target.cy;
  }

  function centre() {
    const cx = size.width / 2;
    let cy = size.height / 2;
    if (card.open && narrow.matches) {
      const stageTop = stage.getBoundingClientRect().top;
      const visible = Math.min(size.height, card.getBoundingClientRect().top - stageTop);
      if (visible > 80) cy = Math.min(cy, visible / 2);
    }
    return { cx, cy };
  }

  // Open or close the card. On a wide screen this changes the width of the canvas, so the
  // globe keeps its place and scale on the page until the next animation moves it.
  function toggleCard(open) {
    const before = { cx: view.cx, cy: view.cy, scale: size.radius * view.zoom };
    if (open) card.show();
    else card.close();
    stage.classList.toggle("has-card", open);
    measure();
    Object.assign(view, { cx: before.cx, cy: before.cy, zoom: before.scale / size.radius });
  }

  function applyView() {
    const scale = size.radius * view.zoom;
    projection.scale(scale).translate([view.cx, view.cy]).rotate([view.lambda, view.phi, 0]);
    // The far side, seen through the globe: the antipodal view, reflected.
    backProjection.scale(scale).translate([view.cx, view.cy]).rotate([view.lambda + 180, -view.phi, 0]);
  }

  /* Drawing */
  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function render() {
    frame = 0;
    if (!land) return;
    applyView();
    const { ratio, width, height } = size;
    const scale = projection.scale();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    context.beginPath();
    path(sphere);
    context.fillStyle = colors.water;
    context.fill();

    // A moving globe at a low zoom uses the coarse outlines, so each frame is quick.
    const shapesNow = moving && coarse && view.zoom < 3 ? coarse : { land, ...lines };

    // Faint far-side outlines show depth only while the whole globe is in view.
    // Each land outline is projected once and serves as the fill and the coastline.
    const through = Math.max(0, 1 - (view.zoom - 1) / 0.5);
    if (through > 0) {
      const far = new Path2D();
      d3.geoPath(backProjection, far)(shapesNow.land);
      context.globalAlpha = through;
      context.fillStyle = colors.backLand;
      context.fill(far);
      context.lineWidth = 0.6;
      context.strokeStyle = colors.back;
      context.stroke(far);
      context.globalAlpha = 1;
    }

    context.beginPath();
    path(graticule);
    context.lineWidth = 0.5;
    context.strokeStyle = colors.grid;
    context.stroke();

    const near = new Path2D();
    d3.geoPath(projection, near)(shapesNow.land);
    context.fillStyle = colors.land;
    context.fill(near);

    if (hovered && hovered !== selected) fillRegion(hovered, colors.hover);
    if (selected) fillRegion(selected, colors.selection);

    // Large lakes are water on every view. The largest lake of the selected region is blue.
    if (lakeShapes.map) {
      const water = new Path2D();
      d3.geoPath(projection, water)(lakeShapes.map);
      context.fillStyle = colors.water;
      context.fill(water);
      context.lineWidth = 0.5;
      context.strokeStyle = colors.coast;
      context.stroke(water);
    }
    const selectedLake = selected && lakeShapes.byRegion.get(selected);
    if (selectedLake) {
      const lake = new Path2D();
      d3.geoPath(projection, lake)(selectedLake);
      context.fillStyle = colors.lake;
      context.fill(lake);
      context.lineWidth = 1.4;
      context.strokeStyle = colors.blue;
      context.stroke(lake);
    }

    context.beginPath();
    path(shapesNow.borders);
    context.lineWidth = view.zoom > 4 ? 0.8 : 0.6;
    context.strokeStyle = colors.border;
    context.stroke();

    context.beginPath();
    path(shapesNow.disputed);
    context.setLineDash([3, 3]);
    context.stroke();
    context.setLineDash([]);

    context.lineWidth = 0.75;
    context.strokeStyle = colors.coast;
    context.stroke(near);

    if (hovered && hovered !== selected) strokeRegion(hovered, colors.ink, 1);
    marks = [];
    riverPath = null;
    if (selected) {
      strokeRegion(selected, colors.blue, 1.5);
      markSmallRegion(selected);
      drawRiver(selected);
      drawPlaces();
    }

    // Shade the limb so the disc reads as a sphere. Close views have no visible limb.
    context.beginPath();
    path(sphere);
    const depth = Math.max(0, 1 - (view.zoom - 1) / 1.5);
    if (depth > 0) {
      const shade = context.createRadialGradient(view.cx, view.cy, scale * 0.55, view.cx, view.cy, scale);
      shade.addColorStop(0, "rgba(0, 0, 0, 0)");
      shade.addColorStop(1, colors.limb);
      context.globalAlpha = depth;
      context.fillStyle = shade;
      context.fill();
      context.globalAlpha = 1;
    }
    context.lineWidth = 1;
    context.strokeStyle = colors.outline;
    context.stroke();

    if (document.activeElement === canvas && canvas.matches(":focus-visible")) drawCrosshair();
  }

  function fillRegion(id, fill) {
    context.beginPath();
    for (const feature of shapes.get(id) ?? []) path(feature);
    context.fillStyle = fill;
    context.fill();
  }

  function strokeRegion(id, stroke, width) {
    context.beginPath();
    for (const feature of shapes.get(id) ?? []) path(feature);
    context.lineWidth = width;
    context.strokeStyle = stroke;
    context.stroke();
  }

  // A small region gets a ring, so the selection stays visible at any zoom.
  function markSmallRegion(id) {
    const focus = regions[id]?.focus;
    if (!focus || !visible(focus)) return;
    const [x, y] = projection([focus[0], focus[1]]);
    const span = projection.scale() * Math.sin(Math.min(focus[2], 90) / degrees);
    if (span > 7) return;
    context.beginPath();
    context.arc(x, y, 9, 0, 2 * Math.PI);
    context.lineWidth = 1.5;
    context.strokeStyle = colors.blue;
    context.stroke();
  }

  // The longest river of the selected region: a blue line with a paper edge. Its path is
  // kept for hovering.
  function drawRiver(id) {
    const river = riverShapes.get(id);
    if (!river) return;
    riverPath = new Path2D();
    d3.geoPath(projection, riverPath)(river);
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = 3.6;
    context.strokeStyle = colors.paper;
    context.stroke(riverPath);
    context.lineWidth = 1.8;
    context.strokeStyle = colors.blue;
    context.stroke(riverPath);
    context.lineJoin = "miter";
    context.lineCap = "butt";
  }

  // Whether a point in CSS pixels lies on the drawn river, with some room for the pointer.
  function onRiver(x, y) {
    if (!riverPath) return false;
    context.save();
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    context.lineWidth = 8;
    const hit = context.isPointInStroke(riverPath, x * size.ratio, y * size.ratio);
    context.restore();
    return hit;
  }

  // Symbols for the selected region: its lake when it has no outline, its highest and
  // lowest points, and numbered pins for its cities. The capital's pin is a star. A
  // capital outside the ten cities is a small star. Each symbol is kept for hovering.
  function drawPlaces() {
    const region = regions[selected];
    if (!region) return;
    const lake = region.lake;
    if (lake?.at && visible(lake.at)) {
      const [x, y] = projection(lake.at);
      halo(() => context.arc(x, y, 4.5, 0, 2 * Math.PI), colors.blue);
      marks.push({ x, y, r: 8, label: `Largest lake: ${lake.name}` });
    }
    for (const key of ["highest", "lowest"]) {
      const point = region[key];
      if (!point?.at || !visible(point.at)) continue;
      const [x, y] = projection(point.at);
      halo(() => triangle(x, y, 6.5, key === "highest" ? -1 : 1), colors.ink);
      marks.push({ x, y, r: 9, label: `${key === "highest" ? "Highest" : "Lowest"} point: ${point.name}, ${metres(point.m)}` });
    }
    const capitalCity = region.capital;
    const cities = region.cities ?? [];
    for (let index = cities.length - 1; index >= 0; index--) {
      const city = cities[index];
      const point = [city[4], city[3]];
      if (!visible(point)) continue;
      const [x, y] = projection(point);
      if (capitalCity?.city === index) {
        drawStarPin(x, y, index + 1, index === activeCity);
        marks.push({ x, y: y - 16, r: 11, label: `Capital: ${city[0]}`, city: index });
      } else {
        drawPin(x, y, index + 1, index === activeCity);
        marks.push({ x, y: y - 15, r: 9.5, label: city[0], city: index });
      }
    }
    if (capitalCity?.at && visible(capitalCity.at)) {
      const [x, y] = projection(capitalCity.at);
      halo(() => star(x, y, 6.5, 3.4), colors.ink);
      marks.push({ x, y, r: 8, label: `Capital: ${capitalCity.name}` });
    }
    marks.reverse();
  }

  // Paint a shape with a paper edge, so it stays legible on any background.
  function halo(shape, fill) {
    context.beginPath();
    shape();
    context.closePath();
    context.lineWidth = 3;
    context.strokeStyle = colors.paper;
    context.stroke();
    context.fillStyle = fill;
    context.fill();
  }

  // A triangle that points up (direction −1) for a highest point, down (1) for a lowest.
  function triangle(x, y, size, direction) {
    context.moveTo(x, y + direction * size);
    context.lineTo(x + size * 0.95, y - direction * size * 0.65);
    context.lineTo(x - size * 0.95, y - direction * size * 0.65);
  }

  // A pin: a round head with the rank, and a point at the city.
  function drawPin(x, y, rank, active) {
    const head = 7.5;
    const top = y - 15;
    context.beginPath();
    context.arc(x, top, head, Math.PI * 0.75, Math.PI * 2.25);
    context.lineTo(x, y);
    context.closePath();
    context.fillStyle = active ? colors.blue : colors.paper;
    context.fill();
    context.lineWidth = 1.2;
    context.strokeStyle = active ? colors.blue : colors.ink;
    context.stroke();
    context.fillStyle = active ? colors.paper : colors.ink;
    context.font = `600 ${rank > 9 ? 8 : 9}px ${colors.sans}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(rank), x, top + 0.5);
  }

  // The capital's pin: a star with the rank, and a point at the city. The star and its
  // point wind the same way, so they fill as one shape inside a paper edge.
  function drawStarPin(x, y, rank, active) {
    const top = y - 16;
    context.beginPath();
    context.moveTo(x + 2.2, top + 4);
    context.lineTo(x, y);
    context.lineTo(x - 2.2, top + 4);
    context.closePath();
    star(x, top, 11, 5.8);
    context.lineJoin = "round";
    context.lineWidth = 2.5;
    context.strokeStyle = colors.paper;
    context.stroke();
    context.lineJoin = "miter";
    context.fillStyle = active ? colors.blue : colors.ink;
    context.fill();
    context.fillStyle = colors.paper;
    context.font = `600 ${rank > 9 ? 7.5 : 9}px ${colors.sans}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(rank), x, top + 1);
  }

  // A five-pointed star, point up, as a sub-path of the current path.
  function star(x, y, outer, inner) {
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 ? inner : outer;
      const angle = Math.PI * (i / 5 - 0.5);
      const px = x + radius * Math.cos(angle);
      const py = y + radius * Math.sin(angle);
      if (i) context.lineTo(px, py);
      else context.moveTo(px, py);
    }
    context.closePath();
  }

  function drawCrosshair() {
    const { cx, cy } = view;
    context.beginPath();
    context.moveTo(cx - 9, cy); context.lineTo(cx - 3, cy);
    context.moveTo(cx + 3, cy); context.lineTo(cx + 9, cy);
    context.moveTo(cx, cy - 9); context.lineTo(cx, cy - 3);
    context.moveTo(cx, cy + 3); context.lineTo(cx, cy + 9);
    context.lineWidth = 1.5;
    context.strokeStyle = colors.blue;
    context.stroke();
  }

  function visible(point) {
    return d3.geoDistance(point, [-view.lambda, -view.phi]) < Math.PI / 2 - 0.01;
  }

  /* Picking: smaller shapes first, so an enclave wins over the country around it. */
  function pick(x, y) {
    applyView();
    const scale = projection.scale();
    if ((x - view.cx) ** 2 + (y - view.cy) ** 2 > scale * scale) return null;
    const point = projection.invert([x, y]);
    if (!point) return null;
    const [lon, lat] = point;
    for (const shape of pickOrder) {
      const [[west, south], [east, north]] = shape.bounds;
      if (lat < south || lat > north) continue;
      if (west <= east ? lon < west || lon > east : lon < west && lon > east) continue;
      if (d3.geoContains(shape.feature, point)) return shape.id;
    }
    return null;
  }

  /* Motion */
  function animateTo(target, duration = 850) {
    if (animation) cancelAnimationFrame(animation.frame);
    const start = { ...view };
    const goal = { ...view, ...target };
    // Turn the short way around.
    goal.lambda = start.lambda + ((((goal.lambda - start.lambda) % 360) + 540) % 360 - 180);
    if (reduceMotion.matches || duration === 0) {
      Object.assign(view, goal);
      animation = null;
      requestRender();
      return;
    }
    const began = performance.now();
    const step = now => {
      const t = Math.min(1, (now - began) / duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      view.lambda = start.lambda + (goal.lambda - start.lambda) * e;
      view.phi = start.phi + (goal.phi - start.phi) * e;
      view.zoom = Math.exp(Math.log(start.zoom) + (Math.log(goal.zoom) - Math.log(start.zoom)) * e);
      view.cx = start.cx + (goal.cx - start.cx) * e;
      view.cy = start.cy + (goal.cy - start.cy) * e;
      moving = t < 1;
      render();
      animation = t < 1 ? { frame: requestAnimationFrame(step) } : null;
    };
    animation = { frame: requestAnimationFrame(step) };
  }

  function stopAnimation() {
    if (animation) {
      cancelAnimationFrame(animation.frame);
      moving = false;
    }
    animation = null;
  }

  // Draw the full outlines once the globe stops moving.
  function settle(delay = 0) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      moving = false;
      requestRender();
    }, delay);
  }

  function fitZoom(radiusDegrees) {
    const { cx, cy } = centre();
    const room = Math.min(cx, cy, size.width - cx, size.height - cy);
    const angle = Math.min(Math.max(radiusDegrees, 0.05), 89) / degrees;
    return clampZoom((0.62 * room) / (size.radius * Math.sin(angle)));
  }

  const clampZoom = zoom => Math.min(MAX_ZOOM, Math.max(1, zoom));

  function zoomBy(factor) {
    stopAnimation();
    view.zoom = clampZoom(view.zoom * factor);
    requestRender();
  }

  /* Selection and the country card */
  function selectRegion(id, { from = "pointer", move = true } = {}) {
    const region = regions[id];
    if (!region) return;
    const wasOpen = card.open;
    returnFocus = from === "select" ? select : from === "pointer" || from === "keyboard" ? canvas : returnFocus;
    selected = id;
    activeCity = -1;
    fillCard(id, region);
    if (!wasOpen) toggleCard(true);
    // On a narrow screen the card covers the lower half of the viewport. Put the
    // globe at the top, so the selected country shows above the card.
    if (narrow.matches) window.scrollTo({ top: window.scrollY + stage.getBoundingClientRect().top, behavior: "instant" });
    if (select.value !== id) {
      select.value = id;
      window.JehlpUI?.enhance(select);
    }
    history.replaceState(null, "", `#${id}`);
    status.textContent = `The card shows ${region.name}.`;
    // Pointer selection keeps focus on the globe. Keyboard and list selection move focus to the card.
    if (from === "pointer") canvas.focus({ preventScroll: true });
    else if (from !== "hash") cardTitle.focus({ preventScroll: true });
    const target = centre();
    if (move && region.focus) {
      animateTo({ lambda: -region.focus[0], phi: Math.max(-80, Math.min(80, -region.focus[1])), zoom: fitZoom(region.focus[2]), ...target });
    } else {
      animateTo(target, 450);
    }
  }

  function closeCard() {
    if (!card.open) return;
    toggleCard(false);
    selected = null;
    activeCity = -1;
    cityLabel.hidden = true;
    select.value = "";
    window.JehlpUI?.enhance(select);
    history.replaceState(null, "", location.pathname + location.search);
    status.textContent = "";
    animateTo({ ...centre(), zoom: clampZoom(view.zoom) }, 450);
    (returnFocus ?? canvas).focus({ preventScroll: true });
  }

  const integer = new Intl.NumberFormat("en-US");
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const significant = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });

  function money(usd) {
    if (usd >= 1e12) return `$${significant.format(usd / 1e12)} trillion`;
    if (usd >= 1e9) return `$${significant.format(usd / 1e9)} billion`;
    return `$${significant.format(usd / 1e6)} million`;
  }
  const metres = m => `${m < 0 ? "−" : ""}${decimal.format(Math.abs(m))} m`;
  const area = lake => {
    if (lake.km2 === null) return "";
    const amount = value => value >= 100 ? integer.format(value) : decimal.format(value);
    return lake.km2Max ? `${amount(lake.km2)}–${amount(lake.km2Max)} km²` : `${amount(lake.km2)} km²`;
  };
  const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
  const percent = share => share < 1 ? "<1%" : `${Math.round(share)}%`;
  const listText = items => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");
  // Group names such as "No religion" start lower case inside a sentence.
  const groupInText = name => /^(No|Other) /.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
  function people(count) {
    if (count >= 1e9) return `${decimal.format(Math.round(count / 1e7) / 100)} billion`;
    if (count >= 1e6) return `${decimal.format(count / 1e6)} million`;
    return integer.format(count);
  }

  // A small copy of a globe symbol, beside the label of the fact that it marks.
  const symbols = {
    highest: "M5 1.5 9.2 8.5H.8z",
    lowest: "M5 8.5 9.2 1.5H.8z",
    lake: "M5 1.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z",
    capital: "M5 .7 6.41 3.46 9.47 3.95 7.28 6.14 7.76 9.2 5 7.8 2.24 9.2 2.72 6.14.53 3.95 3.59 3.46z",
    river: "M.9 6.3c1.4-2.6 2.7-2.6 4.1 0s2.7 2.6 4.1 0",
  };
  function symbol(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 10 10");
    svg.setAttribute("class", `fact-symbol fact-symbol--${kind}`);
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", symbols[kind]);
    svg.append(shape);
    return svg;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // A fact row: a label, a text value, a figure in a right-aligned column, and a note.
  function fact(list, label, { text = "", figure = "", year = null, note = "", mark = null, empty = false }) {
    const term = element("dt");
    if (mark) term.append(symbol(mark));
    term.append(label);
    const value = element("dd");
    if (text) value.append(element("span", empty ? "fact-text fact-text--empty" : "fact-text", text));
    if (figure) {
      const cell = element("span", "fact-figure", figure);
      if (year) cell.append(element("span", "card-year", String(year)));
      value.append(cell);
    }
    if (note) value.append(element("span", "fact-note", note));
    list.append(term, value);
  }

  function fillCard(id, region) {
    cardTitle.textContent = region.name;
    const note = document.getElementById("card-note");
    note.textContent = region.note ?? "";
    note.hidden = !region.note;

    const facts = document.getElementById("card-facts");
    facts.replaceChildren();
    const noData = { text: "No data", empty: true };
    const noneRecorded = { text: "None recorded", empty: true };
    if (!region.unassigned) {
      fact(facts, "Population", region.population
        ? { figure: people(region.population.count), year: region.population.year } : noData);
      fact(facts, "GDP", region.gdp ? { figure: money(region.gdp.usd), year: region.gdp.year } : noData);
      if (region.capital) fact(facts, "Capital", { text: region.capital.name, note: region.capital.note, mark: "capital" });
      if (region.government) fact(facts, "Government", { text: region.government.type, note: region.government.note });
      const founding = region.independence;
      if (founding) {
        const earlier = founding.earlier && `Earlier: ${founding.earlier.date}${founding.earlier.description ? ` — ${founding.earlier.description}` : ""}`;
        fact(facts, founding.label, {
          text: founding.date,
          note: [founding.description, earlier].filter(Boolean).map(part => part.replace(/\.$/, "")).join(". "),
        });
      }
      if (region.former) fact(facts, region.former.length === 1 ? "Former name" : "Former names", { text: region.former.join(", ") });
      const languages = region.languages ?? { list: [] };
      fact(facts, languages.list.length === 1 ? "Official language" : "Official languages",
        { text: languages.list.length ? languages.list.join(", ") : "None", note: languages.note });
      const religion = region.religion;
      fact(facts, "Main religion", religion ? {
        text: religion.name,
        figure: religion.share === null ? "" : percent(religion.share),
        year: religion.share === null ? null : religion.year,
        note: religion.next ? `Next largest: ${groupInText(religion.next.name)}, ${percent(religion.next.share)}` : "",
      } : noData);
      for (const [key, label] of [["highest", "Highest point"], ["lowest", "Lowest point"]]) {
        const point = region[key];
        fact(facts, label, point ? { text: point.name, figure: metres(point.m), mark: point.at ? key : null } : noData);
      }
      const lake = region.lake;
      fact(facts, "Largest lake", lake ? {
        text: lake.name,
        figure: area(lake),
        note: [lake.kind ? capital(lake.kind) : "", lake.shared?.length ? `Shared with ${lake.shared.join(", ")}` : "",
          lake.km2 === null ? "The area is not recorded" : ""].filter(Boolean).join(". "),
        mark: lake.outline || lake.at ? "lake" : null,
      } : noneRecorded);
      const river = region.river;
      fact(facts, "Longest river", river ? {
        text: river.name,
        figure: river.km === null ? "" : `${integer.format(river.km)} km`,
        note: river.shared.length ? `Also flows through ${listText(river.shared)}` : "",
        mark: river.drawn ? "river" : null,
      } : noneRecorded);
      const disaster = region.disaster;
      fact(facts, "Deadliest disaster since 1900", disaster ? {
        text: disaster.name ?? `${disaster.type}, ${disaster.year}`,
        figure: `${integer.format(disaster.deaths)} ${disaster.deaths === 1 ? "death" : "deaths"}`,
        note: disaster.name ? `${disaster.type}, ${disaster.year}` : "",
      } : noneRecorded);
    }

    // Acronyms carry their full name. Names such as "African Union" stand alone.
    const membershipList = document.getElementById("membership-list");
    membershipList.replaceChildren();
    const memberships = region.memberships ?? [];
    for (const key of memberships) {
      const org = organizations[key];
      const item = element("li");
      if (/^[A-Z0-9]+$|^Mercosur$/.test(org.label) && org.label !== org.name) {
        const abbr = element("abbr", "", org.label);
        abbr.title = org.name;
        item.append(abbr);
      } else {
        item.textContent = org.label;
      }
      membershipList.append(item);
    }
    membershipList.hidden = !memberships.length;
    document.getElementById("memberships-empty").hidden = Boolean(memberships.length);
    membershipList.closest("section").hidden = Boolean(region.unassigned);

    const exportsList = document.getElementById("export-list");
    const exportsYear = document.getElementById("exports-year");
    exportsList.replaceChildren();
    const exportsSection = exportsList.closest("section");
    exportsSection.hidden = Boolean(region.unassigned);
    const items = region.exports?.items ?? [];
    for (const item of items) exportsList.append(element("li", "", capital(item)));
    exportsList.hidden = !items.length;
    document.getElementById("exports-empty").hidden = Boolean(items.length);
    exportsYear.textContent = items.length && region.exports.year ? String(region.exports.year) : "";

    const rows = document.getElementById("city-rows");
    const empty = document.getElementById("cities-empty");
    const table = document.getElementById("city-table");
    rows.replaceChildren();
    const cities = region.cities ?? [];
    table.hidden = !cities.length;
    empty.hidden = Boolean(cities.length);
    empty.textContent = cities.length ? "" : "No populated places are listed.";
    document.getElementById("cities-title").closest("section").hidden = Boolean(region.unassigned);
    cities.forEach((city, index) => {
      const row = element("tr");
      row.dataset.index = String(index);
      const name = element("td", "", city[0]);
      if (region.capital?.city === index) name.append(symbol("capital"), element("span", "sr-only", " (capital)"));
      row.append(
        element("td", "", String(index + 1)),
        name,
        element("td", "num", integer.format(city[1])),
        element("td", "num year", city[2] ? String(city[2]) : ""),
      );
      rows.append(row);
    });

    const sources = document.getElementById("card-sources");
    sources.hidden = Boolean(region.unassigned);
    if (!region.unassigned) {
      const gdpSource = region.gdp ? `GDP: ${region.gdp.source}. ` : "";
      const disasterSource = region.disaster ? `Disaster: ${region.disaster.source === "EM-DAT" ? "EM-DAT" : region.disaster.source}. ` : "";
      const religionSource = region.religion ? `Religion: ${region.religion.source}. ` : "";
      sources.textContent = `${gdpSource}${religionSource}${disasterSource}Cities and capital: GeoNames and Wikidata. Other values: The World Factbook and Wikidata.`;
    }
    card.querySelector(".card-body").scrollTop = 0;
  }

  // Point to a city on the globe while the reader hovers its row.
  document.getElementById("city-rows").addEventListener("pointerover", event => {
    const row = event.target.closest("tr");
    if (!row) return;
    activeCity = Number(row.dataset.index);
    for (const other of row.parentElement.children) other.classList.toggle("is-active", other === row);
    placeCityLabel();
    requestRender();
  });
  document.getElementById("city-rows").addEventListener("pointerleave", event => {
    activeCity = -1;
    for (const row of event.currentTarget.children) row.classList.remove("is-active");
    cityLabel.hidden = true;
    requestRender();
  });

  function placeCityLabel() {
    applyView();
    const city = regions[selected]?.cities?.[activeCity];
    if (!city || !visible([city[4], city[3]])) {
      cityLabel.hidden = true;
      return;
    }
    const [x, y] = projection([city[4], city[3]]);
    cityLabel.textContent = city[0];
    cityLabel.hidden = false;
    cityLabel.style.left = `${Math.round(Math.min(x + 8, labelLimit() - cityLabel.offsetWidth))}px`;
    cityLabel.style.top = `${Math.round(y - 26)}px`;
  }

  /* Pointer input: drag to turn, pinch or scroll to zoom, click to select. */
  const pointers = new Map();
  let gesture = null;

  canvas.addEventListener("pointerdown", event => {
    if (!land || event.button > 0) return;
    stopAnimation();
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (pointers.size === 1) {
      gesture = { kind: "turn", x: event.offsetX, y: event.offsetY, lambda: view.lambda, phi: view.phi, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom, moved: true };
    }
  });

  canvas.addEventListener("pointermove", event => {
    if (!land) return;
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === "mouse") hover(event.offsetX, event.offsetY);
      return;
    }
    pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (gesture?.kind === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      view.zoom = clampZoom(gesture.zoom * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance);
      moving = true;
      requestRender();
    } else if (gesture?.kind === "turn") {
      const dx = event.offsetX - gesture.x;
      const dy = event.offsetY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
      gesture.moved = true;
      canvas.classList.add("is-dragging");
      hideHover();
      const perPixel = degrees / (size.radius * view.zoom);
      view.lambda = gesture.lambda + dx * perPixel;
      view.phi = Math.max(-90, Math.min(90, gesture.phi - dy * perPixel));
      if (activeCity >= 0) placeCityLabel();
      moving = true;
      requestRender();
    }
  });

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    canvas.classList.remove("is-dragging");
    if (moving) settle();
    if (gesture?.kind === "turn" && !gesture.moved && event.type === "pointerup") {
      const id = pick(event.offsetX, event.offsetY);
      if (id) selectRegion(id, { from: "pointer" });
      else closeCard();
    }
    gesture = pointers.size ? { kind: "done", moved: true } : null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", event => { if (event.pointerType === "mouse") hideHover(); });

  canvas.addEventListener("wheel", event => {
    if (!land) return;
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    const next = clampZoom(view.zoom * factor);
    // At a zoom limit, let the page scroll instead.
    if (next === view.zoom) return;
    event.preventDefault();
    stopAnimation();
    view.zoom = next;
    moving = true;
    settle(160);
    requestRender();
  }, { passive: false });

  let hoverFrame = 0;
  function hover(x, y) {
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      let mark = marks.find(entry => (entry.x - x) ** 2 + (entry.y - y) ** 2 <= entry.r ** 2);
      if (mark || pointedMark) pointAt(mark);
      if (!mark && onRiver(x, y)) mark = { x, y, label: `Longest river: ${regions[selected]?.river?.name ?? ""}` };
      if (mark) {
        canvas.classList.remove("is-pointing");
        if (hovered) { hovered = null; requestRender(); }
        hoverLabel.textContent = mark.label;
        hoverLabel.hidden = false;
        hoverLabel.style.left = `${Math.max(4, Math.min(mark.x + 12, labelLimit() - hoverLabel.offsetWidth))}px`;
        hoverLabel.style.top = `${Math.max(4, mark.y - 34)}px`;
        return;
      }
      const id = pick(x, y);
      canvas.classList.toggle("is-pointing", Boolean(id));
      if (id !== hovered) {
        hovered = id;
        requestRender();
      }
      if (id) {
        hoverLabel.textContent = regions[id]?.name ?? "";
        hoverLabel.hidden = false;
        const left = Math.min(x + 14, labelLimit() - hoverLabel.offsetWidth);
        hoverLabel.style.left = `${Math.max(4, left)}px`;
        hoverLabel.style.top = `${Math.max(4, y - 34)}px`;
      } else {
        hoverLabel.hidden = true;
      }
    });
  }

  // Labels stay inside the canvas, which ends where the card begins.
  const labelLimit = () => size.width - 4;

  // A pin under the pointer marks its row in the card.
  function pointAt(mark) {
    pointedMark = mark ?? null;
    const index = mark?.city ?? -1;
    if (index === activeCity) return;
    activeCity = index;
    for (const row of document.getElementById("city-rows").children) row.classList.toggle("is-active", Number(row.dataset.index) === index);
    requestRender();
  }

  function hideHover() {
    if (pointedMark) pointAt(null);
    hoverLabel.hidden = true;
    canvas.classList.remove("is-pointing");
    if (hovered) {
      hovered = null;
      requestRender();
    }
  }

  /* Keyboard input on the globe */
  canvas.addEventListener("keydown", event => {
    if (!land) return;
    // The view centre is at longitude −lambda and latitude −phi.
    const turn = 8 / view.zoom;
    const keys = {
      ArrowLeft: () => { view.lambda += turn; },
      ArrowRight: () => { view.lambda -= turn; },
      ArrowUp: () => { view.phi = Math.max(-90, view.phi - turn); },
      ArrowDown: () => { view.phi = Math.min(90, view.phi + turn); },
      "+": () => { view.zoom = clampZoom(view.zoom * 1.5); },
      "=": () => { view.zoom = clampZoom(view.zoom * 1.5); },
      "-": () => { view.zoom = clampZoom(view.zoom / 1.5); },
      "_": () => { view.zoom = clampZoom(view.zoom / 1.5); },
      Home: () => resetView(),
      Enter: () => {
        const id = pick(view.cx, view.cy);
        if (id) selectRegion(id, { from: "keyboard", move: false });
        else status.textContent = "No country is at the center of the globe.";
      },
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    stopAnimation();
    action();
    requestRender();
  });
  canvas.addEventListener("focus", requestRender);
  canvas.addEventListener("blur", requestRender);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && card.open && !event.defaultPrevented) {
      // The select menu handles its own Escape key first.
      if (event.target.closest?.(".ui-select")) return;
      event.preventDefault();
      closeCard();
    }
  });

  /* Controls */
  document.getElementById("card-close").addEventListener("click", closeCard);
  for (const button of document.querySelectorAll("[data-zoom]")) {
    button.addEventListener("click", () => zoomBy(Number(button.dataset.zoom) > 0 ? 1.6 : 1 / 1.6));
  }
  function resetView() {
    animateTo({ ...home, ...centre() }, 700);
  }
  document.querySelector('[data-view="reset"]').addEventListener("click", resetView);

  select.addEventListener("change", () => {
    if (select.value) selectRegion(select.value, { from: "select" });
    else closeCard();
  });

  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (regions[id] && id !== selected) selectRegion(id, { from: "hash" });
  });

  window.addEventListener("jehlp:themechange", () => {
    readColors();
    requestRender();
  });

  new ResizeObserver(() => {
    measure();
    if (activeCity >= 0) placeCityLabel();
    render();
  }).observe(stage);
  narrow.addEventListener("change", () => {
    measure();
    requestRender();
  });

  /* Data */
  async function load() {
    readColors();
    measure();
    try {
      const [topology, data, simple, lakes, rivers] = await Promise.all(["data/world.json", "data/countries.json", "data/world-coarse.json", "data/lakes.json", "data/rivers.json"].map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return response.json();
      }));
      regions = data.regions;
      organizations = data.organizations;
      const features = topojson.feature(topology, topology.objects.countries).features;
      shapes = new Map();
      pickOrder = [];
      for (const feature of features) {
        const id = feature.properties.id;
        if (!shapes.has(id)) shapes.set(id, []);
        shapes.get(id).push(feature);
        if (regions[id] && !regions[id].focus) regions[id].focus = feature.properties.focus;
        pickOrder.push({ id, feature, bounds: d3.geoBounds(feature), area: d3.geoArea(feature) });
      }
      pickOrder.sort((a, b) => a.area - b.area);
      land = topojson.merge(topology, topology.objects.countries.geometries);
      lines = {
        borders: topojson.feature(topology, topology.objects.borders),
        disputed: topojson.feature(topology, topology.objects.disputed),
      };
      const lakeList = topojson.feature(lakes, lakes.objects.lakes).features;
      lakeShapes = { map: { type: "FeatureCollection", features: lakeList.filter(lake => lake.properties.map) }, byRegion: new Map() };
      for (const lake of lakeList) {
        for (const id of lake.properties.regions ?? []) {
          if (!lakeShapes.byRegion.has(id)) lakeShapes.byRegion.set(id, { type: "FeatureCollection", features: [] });
          lakeShapes.byRegion.get(id).features.push(lake);
        }
      }
      riverShapes = new Map();
      for (const river of topojson.feature(rivers, rivers.objects.rivers).features) {
        for (const id of river.properties.regions) riverShapes.set(id, river);
      }
      coarse = {
        land: topojson.feature(simple, simple.objects.land),
        borders: topojson.feature(simple, simple.objects.borders),
        disputed: topojson.feature(simple, simple.objects.disputed),
      };
      const count = Object.keys(regions).length;
      status.textContent = `${count} countries and territories.`;
      document.getElementById("data-date").textContent = `Data collected on ${data.collected}.`;
      render();
      const id = location.hash.slice(1);
      if (regions[id]) selectRegion(id, { from: "hash" });
    } catch (error) {
      status.textContent = "The globe data did not load. Reload the page to try again.";
      console.error(error);
    }
  }

  load();
})();
