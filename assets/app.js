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
  let shapes = new Map();
  let pickOrder = [];
  let land = null;
  let lines = {};
  let coarse = null;
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

  /* Layout: the globe sits beside the open card on a wide screen and above it on a narrow one. */
  function measure() {
    const rect = stage.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    size = { width: rect.width, height: rect.height, ratio, radius: Math.max(60, Math.min(rect.width, rect.height) / 2 - 14) };
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const target = centre();
    view.cx = target.cx;
    view.cy = target.cy;
  }

  function centre() {
    let cx = size.width / 2;
    let cy = size.height / 2;
    if (card.open && !narrow.matches) {
      const free = size.width - card.offsetWidth - 16;
      cx = Math.min(cx, Math.max(free / 2, size.radius * 0.9));
    } else if (card.open) {
      const stageTop = stage.getBoundingClientRect().top;
      const visible = Math.min(size.height, card.getBoundingClientRect().top - stageTop);
      if (visible > 80) cy = Math.min(cy, visible / 2);
    }
    return { cx, cy };
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
    if (selected) {
      strokeRegion(selected, colors.blue, 1.5);
      markSmallRegion(selected);
      drawCities();
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

  function drawCities() {
    const cities = regions[selected]?.cities ?? [];
    cities.forEach((city, index) => {
      const point = [city[4], city[3]];
      if (!visible(point)) return;
      const [x, y] = projection(point);
      const active = index === activeCity;
      context.beginPath();
      context.arc(x, y, active ? 4.5 : 2.6, 0, 2 * Math.PI);
      context.fillStyle = active ? colors.blue : colors.paper;
      context.fill();
      context.lineWidth = 1.2;
      context.strokeStyle = active ? colors.paper : colors.ink;
      context.stroke();
    });
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
    if (!wasOpen) card.show();
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
    card.close();
    selected = null;
    activeCity = -1;
    cityLabel.hidden = true;
    select.value = "";
    window.JehlpUI?.enhance(select);
    history.replaceState(null, "", location.pathname + location.search);
    status.textContent = "";
    animateTo(centre(), 450);
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

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fact(list, label, parts) {
    list.append(element("dt", "", label));
    const value = element("dd");
    for (const part of parts) if (part) value.append(part);
    list.append(value);
  }

  function fillCard(id, region) {
    cardTitle.textContent = region.name;
    const note = document.getElementById("card-note");
    note.textContent = region.note ?? "";
    note.hidden = !region.note;

    const facts = document.getElementById("card-facts");
    facts.replaceChildren();
    const noData = () => element("span", "card-empty-value", "No data");
    if (!region.unassigned) {
      fact(facts, "GDP", region.gdp
        ? [element("span", "fact-value", money(region.gdp.usd)), element("span", "card-year", String(region.gdp.year))]
        : [noData()]);
      const languages = region.languages ?? { list: [] };
      fact(facts, languages.list.length === 1 ? "Official language" : "Official languages", [
        languages.list.length ? document.createTextNode(languages.list.join(", ")) : element("span", "", "None"),
        languages.note ? element("span", "fact-note", languages.note) : null,
      ]);
      for (const [key, label] of [["highest", "Highest point"], ["lowest", "Lowest point"]]) {
        const point = region[key];
        fact(facts, label, point
          ? [document.createTextNode(`${point.name} `), element("span", "fact-value", metres(point.m))]
          : [noData()]);
      }
      const lake = region.lake;
      const lakeNote = lake && [lake.kind ? capital(lake.kind) : "", lake.shared?.length ? `Shared with ${lake.shared.join(", ")}` : "",
        lake.km2 === null ? "The area is not recorded" : ""].filter(Boolean).join(". ");
      fact(facts, "Largest lake", lake
        ? [document.createTextNode(`${lake.name} `), area(lake) ? element("span", "fact-value", area(lake)) : null,
          lakeNote ? element("span", "fact-note", lakeNote) : null]
        : [element("span", "", "None recorded")]);
    }

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
      row.append(
        element("td", "", String(index + 1)),
        element("td", "", city[0]),
        element("td", "num", integer.format(city[1])),
        element("td", "num year", city[2] ? String(city[2]) : ""),
      );
      rows.append(row);
    });

    const sources = document.getElementById("card-sources");
    sources.replaceChildren();
    sources.hidden = Boolean(region.unassigned);
    if (!region.unassigned) {
      const gdpSource = region.gdp ? `GDP: ${region.gdp.source}. ` : "";
      sources.append(document.createTextNode(`${gdpSource}Cities: GeoNames and Wikidata. Other values: The World Factbook and Wikidata. `));
      const link = element("a", "", "Sources and method");
      link.href = "#sources";
      sources.append(link);
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
    cityLabel.style.left = `${Math.round(x + 8)}px`;
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
      const id = pick(x, y);
      canvas.classList.toggle("is-pointing", Boolean(id));
      if (id !== hovered) {
        hovered = id;
        requestRender();
      }
      if (id) {
        hoverLabel.textContent = regions[id]?.name ?? "";
        hoverLabel.hidden = false;
        const left = Math.min(x + 14, size.width - hoverLabel.offsetWidth - 4);
        hoverLabel.style.left = `${Math.max(4, left)}px`;
        hoverLabel.style.top = `${Math.max(4, y - 34)}px`;
      } else {
        hoverLabel.hidden = true;
      }
    });
  }

  function hideHover() {
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
      const [topology, data, simple] = await Promise.all(["data/world.json", "data/countries.json", "data/world-coarse.json"].map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return response.json();
      }));
      regions = data.regions;
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
      coarse = {
        land: topojson.feature(simple, simple.objects.land),
        borders: topojson.feature(simple, simple.objects.borders),
        disputed: topojson.feature(simple, simple.objects.disputed),
      };
      const count = Object.keys(regions).length;
      status.textContent = `${count} countries and territories.`;
      document.getElementById("sources-date").textContent = `Data collected on ${data.collected}.`;
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
