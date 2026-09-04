/* ============================================================
   Geo Drone — screens 4 to 8, one round per shape

   Screens 1-3 teach the mission in two halves: the survey feed
   asks "which of these is the same SHAPE as the craft", and the
   landing asks "which of these is the same AREA". From screen 4 on,
   each screen is one complete round that asks both, for a new shape
   and a new area formula:

     4  square         area = side x side
     5  rectangle      area = length x width
     6  parallelogram  area = base x height
     7  trapezium      area = 1/2 x (a + b) x height
     8  rhombus        area = 1/2 x d1 x d2

   and every one of them runs the same six beats:

     identify the shape  →  filter the landing zones that match it
     →  work out the area the craft needs  →  compare the areas on
     offer  →  pick the exact match  →  land

   This file is the DATA and the MARKUP. The flow that plays it is
   runRound() in js/script.js, which is one function for all five
   screens — the difference between them lives entirely below.

   ── why the numbers are here and not in the stylesheet ─────────

   Landing is one flat shape coming down onto another (the camera
   looks straight down), so a craft is square on an island when the
   two CENTRES OF AREA line up, and it FITS when the two painted
   areas match. Both of those are properties of the artwork, not of
   the layout, so every figure below was measured off the alpha
   channel of the PNG it describes:

     land          fill %  centre of area      craft            fill %  centre of area
     Triangle       40.857  (49.86, 63.32)     Triangle ship     31.407  (49.92, 47.72)
     Square         62.728  (49.98, 50.01)     Square ship       37.389  (49.84, 37.83)
     Rectangle      40.671  (50.00, 49.00)     Rectangle ship    26.957  (49.81, 43.16)
     Parallelogram  37.538  (49.55, 48.79)     Trapezium ship    29.117  (50.26, 38.85)
     Trapezium      42.410  (49.99, 55.66)     Parallelogram sh  39.193  (49.92, 45.09)
     Rhombus        38.159  (49.80, 49.21)     Rhombus ship      21.258  (49.89, 41.49)

   A craft's fill is its HULL: the flame is masked out by colour,
   which is what reproduces the 31.407% / (49.92, 47.72) that screen
   3 was built on. Everything else — the pad sizes, the ship box,
   the fall arithmetic in padPlan() — is derived from those two
   columns at load, so there is one place to correct if a PNG is
   ever redrawn, and no figure is repeated anywhere it could drift.

   ── the two pieces of artwork that are swapped ─────────────────

   Parallelogram spaceship.png is a TRAPEZIUM: its rows widen from
   45.9% of the canvas at the top to 95.7% at the bottom.
   Trapezium spaceship.png is a PARALLELOGRAM: every row is 58.0%
   wide and they shear steadily sideways.

   The two land tiles are both correct, so the round for each shape
   is wired to the craft whose hull IS that shape, which is why the
   `craft` names below read as though they were crossed over. They
   are not: the files are. Renaming the two PNGs and swapping these
   two lines back is a safe change to make later.

   ── where the artwork still does not quite agree ───────────────

   Matched on area, a craft and its island are not always the same
   PROPORTIONS, because the two drawings were not drawn to one
   ratio. Screen 3 already documents this for the triangle (the
   craft lands 5.2% wider and 7.5% shorter than the island it
   fits); the others come out at 3% (square), 8% (rectangle), 5%
   (parallelogram), 7% (rhombus), and worst for the trapezium,
   whose land tapers to 28% of its base while the hull only tapers
   to 48%. The areas are exact in every case — that is what the
   lesson is about — but closing the shape gap is an artwork
   change, not a code one. Forcing it here (a non-uniform squash,
   or scaling to a side instead of to the area) would make the
   too-small and too-large verdicts lie.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------- the land
     One entry per shape of island. `fill` and `c` come off the alpha
     channel; `outline`, `clip` and `ring` are the silhouette traced
     in the same box units, so the verdict outline is the actual
     coastline, the tap target is the actual land, and the invitation
     ring is a circle in the water that clears every corner.        */
  var LAND = {
    triangle: {
      img: 'Triangle.png', fill: 40.857, cx: 0.4986, cy: 0.6332,
      outline: 'M50.1 7.7 98.6 91.4H1.1z',
      clip: 'polygon(50.1% 7.7%, 98.6% 91.4%, 1.1% 91.4%)',
      ring: [49.9, 63.3, 118], label: [49.9, 62],
      adjective: 'triangular'
    },
    square: {
      img: 'Square.png', fill: 62.728, cx: 0.4998, cy: 0.5001,
      outline: 'M10.3 10.5H89.7V89.5H10.3z',
      clip: 'polygon(10.3% 10.5%, 89.7% 10.5%, 89.7% 89.5%, 10.3% 89.5%)',
      ring: [50, 50, 118], label: [50, 50],
      adjective: 'square'
    },
    rectangle: {
      img: 'Rectangle.png', fill: 40.671, cx: 0.5000, cy: 0.4900,
      outline: 'M3.4 27.2H96.6V70.8H3.4z',
      clip: 'polygon(3.4% 27.2%, 96.6% 27.2%, 96.6% 70.8%, 3.4% 70.8%)',
      /* a ring round a shape this flat only has to clear the two
         far corners, 51.4 box units out — 112% rather than 118% */
      ring: [50, 49, 112], label: [50, 49],
      adjective: 'rectangular'
    },
    parallelogram: {
      img: 'Parallelogram.png', fill: 37.538, cx: 0.4955, cy: 0.4879,
      outline: 'M34.4 18.8H97L64.8 78.9H2.2z',
      clip: 'polygon(34.4% 18.8%, 97% 18.8%, 64.8% 78.9%, 2.2% 78.9%)',
      ring: [49.6, 48.8, 118], label: [49.6, 48.8],
      adjective: 'parallelogram'
    },
    trapezium: {
      img: 'Trapezium.png', fill: 42.410, cx: 0.4999, cy: 0.5566,
      outline: 'M36.3 15.7H63.7L99.2 82.9H0.8z',
      clip: 'polygon(36.3% 15.7%, 63.7% 15.7%, 99.2% 82.9%, 0.8% 82.9%)',
      ring: [50, 55.7, 118], label: [50, 55],
      adjective: 'trapezium'
    },
    rhombus: {
      img: 'Rhombus.png', fill: 38.159, cx: 0.4980, cy: 0.4921,
      outline: 'M49.9 4.6 92.5 48.9 49.9 93.1 7.2 48.9z',
      clip: 'polygon(49.9% 4.6%, 92.5% 48.9%, 49.9% 93.1%, 7.2% 48.9%)',
      /* the far vertex is only 43.9 units out, so this ring is much
         tighter than the others or it would float miles offshore */
      ring: [49.8, 49.2, 96], label: [49.8, 49.2],
      adjective: 'rhombus'
    }
  };

  /* The bounding box of each painted silhouette, in box units, read
     out of that shape's own clip polygon rather than written down a
     second time — the scatter below has to know how much water an
     island actually covers, and this way that figure cannot drift
     from the outline it came from. */
  Object.keys(LAND).forEach(function (key) {
    var n = LAND[key].clip.match(/-?[\d.]+(?=%)/g).map(Number);
    var xs = [], ys = [], i;
    for (i = 0; i < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
    LAND[key].ext = [
      Math.min.apply(null, xs) / 100, Math.min.apply(null, ys) / 100,
      Math.max.apply(null, xs) / 100, Math.max.apply(null, ys) / 100
    ];
  });


  /* ---------------------------------------------------------- callouts
     The dimension overlay is drawn in PERCENT OF THE SHIP BOX: the
     <svg> is placed at -28%/-6% and sized 132%, and its viewBox is
     the same numbers, so one user unit is one percent of the box and
     every coordinate below can be read straight off the hull
     measurements. Same contract as screen 3.

     Three primitives, so a callout is described by the points it
     measures rather than by a hand-written path:

       across()  extension lines, an arrowed line and the number,
                 measuring a horizontal side
       beside()  the same, turned down the left-hand side
       perp()    the perpendicular height dropped through the shape,
                 with the little square that says it is a right
                 angle                                              */

  function path(cls, d) { return '<path class="' + cls + '" d="' + d + '" />'; }

  function num(x, y, txt) {
    return '<text class="dim__text" x="' + x + '" y="' + y + '">' + txt + '</text>';
  }

  function numDown(x, y, txt) {
    return '<text class="dim__text" x="' + x + '" y="' + y +
           '" transform="rotate(-90 ' + x + ' ' + y + ')">' + txt + '</text>';
  }

  /* o: x1, x2  the two points being measured
        from    the y they sit on (the hull edge)
        y       where the dimension line goes — under the exhaust for
                a base, over the nose for a top side
        ty      the number's baseline
        tx      only when the number should not sit at the midpoint */
  function across(o) {
    var away = o.y > o.from ? 1 : -1;
    var past = o.y + away * 4;
    return path('dim__ext', 'M' + o.x1 + ' ' + o.from + 'V' + past +
                            'M' + o.x2 + ' ' + o.from + 'V' + past) +
           path('dim__line', 'M' + o.x1 + ' ' + o.y + 'H' + o.x2) +
           path('dim__tip', 'M' + o.x1 + ' ' + o.y + 'l6.4-2.7v5.4z' +
                            'M' + o.x2 + ' ' + o.y + 'l-6.4-2.7v5.4z') +
           num(o.tx == null ? (o.x1 + o.x2) / 2 : o.tx, o.ty, o.text);
  }

  /* o: y1, y2  the two rows being measured
        f1, f2  the x each of those rows starts at, so the extension
                lines leave the hull rather than crossing it
        x       where the dimension line goes (negative: off to the
                left of the craft, in open water)                    */
  function beside(o) {
    var past = o.x - 5;
    return path('dim__ext', 'M' + o.f1 + ' ' + o.y1 + 'H' + past +
                            'M' + o.f2 + ' ' + o.y2 + 'H' + past) +
           path('dim__line', 'M' + o.x + ' ' + o.y1 + 'V' + o.y2) +
           path('dim__tip', 'M' + o.x + ' ' + o.y1 + 'l-2.7 6.4h5.4z' +
                            'M' + o.x + ' ' + o.y2 + 'l-2.7-6.4h5.4z') +
           numDown(o.x - 7, (o.y1 + o.y2) / 2, o.text);
  }

  function perp(x, yt, yb) {
    return path('dim__inner', 'M' + x + ' ' + yt + 'V' + yb) +
           path('dim__square', 'M' + x + ' ' + (yb - 7.4) + 'H' + (x + 7.4) + 'V' + yb);
  }


  /* ---------------------------------------------------------- the craft
     `fill` and `c` are the HULL, flame masked out. `flame` is how
     far down the exhaust reaches, in box units, off the unmasked
     alpha: a base callout goes UNDER the flame, never through it,
     which is why each one sits at a different y — and it is the
     lowest ink on the craft, so it is what has to clear the island
     row while the craft is hovering over it.                       */
  var CRAFT = {
    square: {
      img: 'Square spaceship.png', fill: 37.389, cx: 0.4984, cy: 0.3783,
      flame: 0.9091,
      alt: 'Square spaceship, each side 6 units',
      /* hull x 18.2..81.5, y 8.3..67.3 — 63.3 across by 59.0 down,
         so the drawn square is 7% wider than it is tall. Both sides
         are still called 6 units: the area is exact, the artwork is
         a little out of square. */
      dims:
        across({ x1: 18.2, x2: 81.5, from: 67.3, y: 95, ty: 110, text: '6 units' }) +
        beside({ x: -8, y1: 8.3, y2: 67.3, f1: 18.2, f2: 18.2, text: '6 units' })
    },

    rectangle: {
      img: 'Rectangle spaceship.png', fill: 26.957, cx: 0.4981, cy: 0.4316,
      flame: 0.8780,
      alt: 'Rectangular spaceship, 10 units long and 5 units wide',
      /* hull x 14.75..84.85, y 23.92..62.36 */
      dims:
        across({ x1: 14.75, x2: 84.85, from: 62.36, y: 92, ty: 107, text: '10 units' }) +
        beside({ x: -8, y1: 23.92, y2: 62.36, f1: 14.75, f2: 14.75, text: '5 units' })
    },

    /* the parallelogram-hulled craft — the file called Trapezium */
    parallelogram: {
      img: 'Trapezium spaceship.png', fill: 29.117, cx: 0.5026, cy: 0.3885,
      flame: 0.8804,
      alt: 'Parallelogram spaceship, base 7 units, height 6 units',
      /* top edge y 14.0 from x 35.7 to 92.7, bottom edge y 63.9 from
         x 7.3 to 64.5: every row 57.9 wide, sheared 0.58 sideways
         per unit down. The height callout is the PERPENDICULAR one —
         that is the whole point of the shape — so it is dropped
         through the middle as well as measured down the side. */
      dims:
        perp(50, 14, 63.9) +
        across({ x1: 7.3, x2: 64.5, from: 63.9, y: 92, ty: 107, text: '7 units' }) +
        beside({ x: -8, y1: 14, y2: 63.9, f1: 35.7, f2: 7.3, text: '6 units' })
    },

    /* the trapezium-hulled craft — the file called Parallelogram */
    trapezium: {
      img: 'Parallelogram spaceship.png', fill: 39.193, cx: 0.4992, cy: 0.4509,
      flame: 0.9577,
      alt: 'Trapezium spaceship, parallel sides 5 and 10 units, height 6 units',
      /* top edge y 14.2 from x 27.2 to 72.8 (45.6 across), bottom
         edge y 69.4 from x 2.4 to 97.3 (94.9 across), 55.2 apart —
         which is 5 : 10 : 6 to within a percent, so the numbers
         printed on it are the numbers it is drawn at. */
      dims:
        perp(50, 14.2, 69.4) +
        across({ x1: 27.2, x2: 72.8, from: 14.2, y: 9, ty: 4.5, text: '5 units' }) +
        across({ x1: 2.4, x2: 97.3, from: 69.4, y: 100, ty: 115, text: '10 units' }) +
        beside({ x: -8, y1: 14.2, y2: 69.4, f1: 27.2, f2: 2.4, text: '6 units' })
    },

    rhombus: {
      img: 'Rhombus spaceship.png', fill: 21.258, cx: 0.4989, cy: 0.4149,
      flame: 0.9410,
      alt: 'Rhombus spaceship, diagonals 6 units and 7 units',
      /* vertices (49.9, 5.5) (79.7, 41.4) (49.9, 76.6) (20.2, 41.4).

         The short diagonal is measured ON ITSELF rather than from a
         line under the craft: this hull is only 21% of its box, so a
         box big enough to match the island's area puts anything
         drawn below the exhaust down among the islands. Arrow tips
         on the two side vertices, number under the line. The long
         diagonal is dashed through the middle and measured off to
         the left in the usual way.

         The number sits off to the LEFT of centre rather than under
         the middle of the line it belongs to: dead centre puts it
         under the porthole and, worse, straight across the long
         diagonal, which then reads as two broken lines instead of
         one. Out here it is clear of both, and of the short
         diagonal above it. */
      dims:
        path('dim__inner', 'M49.9 5.5V76.6') +
        path('dim__line', 'M20.2 41.4H79.7') +
        path('dim__tip', 'M20.2 41.4l6.4-2.7v5.4zM79.7 41.4l-6.4-2.7v5.4z') +
        num(32, 57, '6 units') +
        beside({ x: -8, y1: 5.5, y2: 76.6, f1: 49.9, f2: 49.9, text: '7 units' })
    }
  };


  /* ---------------------------------------------------------- the rounds

     `row` is the three islands of the round's own shape, left to
     right, in SQUARE UNITS. The smallest is always in the middle,
     for the reason screen 3's middle pad is the smallest one: the
     craft's base callout hangs below the hull, and only the shortest
     island leaves it room. Which side holds the answer alternates,
     so the fit is never in the same place twice.

     The wrong answers are the arithmetic slips the shape invites,
     not arbitrary numbers — the perimeter instead of the area, or
     the product of the two lengths with the half forgotten — so
     flying the craft onto one is the mistake made visible.

     `decoys` are the two shapes that are NOT the round's shape, and
     they are chosen mathematically rather than for variety: a square
     IS a rectangle, a rhombus and a parallelogram, and a rhombus IS
     a parallelogram, so none of those can ever stand as a wrong
     answer to "select the parallelograms". Every pairing below is
     one a mathematician would accept.                              */
  var ROUNDS = [
    {
      shape: 'square',
      area: 36,                       /* 6 x 6 */
      say: 'The spaceship is a square. Select all the square landing zones.',
      areaKey: 'calcArea',
      copy: {
        formula: 'AREA = SIDE × SIDE',
        tally:   'SIDE 6',
        sum:     'AREA = 6 × 6 = 36'
      },
      row: [54, 24, 36],              /* 24 is the perimeter */
      decoys: ['triangle', 'trapezium']
    },

    {
      shape: 'rectangle',
      area: 50,                       /* 10 x 5 */
      say: 'The spaceship is a rectangle. Select all the rectangular landing zones.',
      areaKey: 'findArea',
      copy: {
        formula: 'AREA = LENGTH × WIDTH',
        tally:   'LENGTH 10 · WIDTH 5',
        sum:     'AREA = 10 × 5 = 50'
      },
      row: [50, 30, 75],              /* 30 is the perimeter */
      decoys: ['trapezium', 'rhombus']
    },

    {
      shape: 'parallelogram',
      area: 42,                       /* 7 x 6 */
      say: 'The spaceship is a parallelogram. Select all the parallelogram landing zones.',
      areaKey: 'calcArea',
      copy: {
        formula: 'AREA = BASE × HEIGHT',
        tally:   'BASE 7 · HEIGHT 6',
        sum:     'AREA = 7 × 6 = 42'
      },
      row: [63, 30, 42],
      decoys: ['triangle', 'trapezium']
    },

    {
      shape: 'trapezium',
      area: 45,                       /* 1/2 x (5 + 10) x 6 */
      say: 'The spaceship is a trapezium. Select all the trapezium landing zones.',
      areaKey: 'findArea',
      copy: {
        formula: 'AREA = ½ × (A + B) × HEIGHT',
        tally:   'A 5 · B 10 · HEIGHT 6',
        sum:     'AREA = ½ × (5 + 10) × 6 = 45'
      },
      row: [45, 30, 90],              /* 90 is the half forgotten */
      decoys: ['rhombus', 'triangle']
    },

    {
      shape: 'rhombus',
      area: 21,                       /* 1/2 x 6 x 7 */
      /* this hull fills only 21% of its canvas, so the box that
         matches a 21-unit island is the tallest on any screen — it
         is hung 3% lower than the others, in css/rounds.css, to
         keep its nose clear of the narration bar */
      say: 'The spaceship is a rhombus. Select all the rhombus landing zones.',
      areaKey: 'calcArea',
      copy: {
        formula: 'AREA = ½ × D₁ × D₂',
        tally:   'D₁ 6 · D₂ 7',
        sum:     'AREA = ½ × 6 × 7 = 21'
      },
      row: [42, 14, 21],              /* 42 is the half forgotten */
      decoys: ['rectangle', 'triangle']
    }
  ];


  /* ---------------------------------------------------------- sizing

     FIT_AREA is what screen 3's 20-unit island actually covers:
     17 box units squared, of which the triangle paints 40.857%. Every
     round's own fit island is drawn to cover the SAME painted area,
     so a 36-unit square and a 20-unit triangle look like the same
     amount of ground and the series keeps one scale throughout.

     From there:
       k(area)  = kFit x sqrt(area / fit area)   — areas in true
                  proportion to the numbers printed on them
       fit      = sqrt(land fill / hull fill)    — a length ratio, so
                  the square root of two areas
       shipK    = kFit x fit                     — the box that makes
                  the PAINTED hull cover exactly the fit island

     DECOY_AREA is a bit under half the fit island: enough to read as
     an island, small enough to sit in the middle distance without
     competing with the row that carries the question.               */
  var FIT_AREA = 17 * 17 * 0.40857;      /* = 118.08 box units of land */
  var DECOY_AREA = FIT_AREA * 0.45;

  function boxFor(paintedArea, land) {
    return Math.sqrt(paintedArea / (land.fill / 100));
  }

  function round2(n) { return Math.round(n * 100) / 100; }


  /* ---------------------------------------------------------- layout
     Where each island sits is a LAYOUT question, so it lives in
     css/rounds.css against the slot classes handed out below —
     `pad--row1/2/3` for the three of the round's own shape, sitting
     in a row on one centre-of-area line exactly as screen 3's three
     do, and `pad--far1/2` for the two decoys, which sit higher up
     the frame, smaller, and wide of the craft's callouts (those
     reach 28% of the ship box out to its left). Keeping it there is
     what lets the portrait and short-screen blocks move a whole
     rank, which an inline style could not be overridden to do.

     The order they breach the water in: near, far, near, near, far,
     so the archipelago arrives scattered instead of in two batches.
     Indices into the DOM order, which is decoys-then-row so the two
     far islands paint behind the three that carry the question. */
  var REVEAL = [2, 0, 3, 4, 1];


  /* ---------------------------------------------------------- the scatter

     While the SHAPE is the question, the five islands are strewn
     about the water and shuffled every time the screen is entered.
     That is not decoration: with the round's own three always in a
     row across the front, "pick the front three" wins the shape task
     without ever looking at a shape, and the question stops being a
     question.

     Once the shape task is over the three survivors drop the scatter
     and go home to the row, which is the arrangement everything
     downstream — the craft's callouts, the HUD line, the fall
     arithmetic — was tuned against. The craft only flies in after
     that: it comes down the middle of the frame, which is water a
     scattered island can perfectly well be sitting in.

     ── the five stations ──

     Two set back and inset, three across the front. The front three
     ARE the row (the same 21/50/79 the area task uses, on the same
     --land-y), so an island that happens to be scattered onto its
     own row station simply stays where it is when the row forms.

     Their y comes off the round's own --far-y and --land-y rather
     than being written here, because the rhombus round runs to a
     smaller unit and a higher row than the other four — see
     css/rounds.css. Read, not hard-coded, so the two cannot drift.

     ── why the shuffle is sampled and not just applied ──

     The islands are sized by the areas printed on them, so they are
     not interchangeable: the trapezium round's 90-unit island is a
     third of the frame across and the rhombus round's 42-unit one is
     40% of it top to bottom, while a decoy is a third of that. Some
     permutations of five such objects across five fixed stations
     simply overlap.

     So every draw is measured before it is used, and rejected if two
     islands would touch or one would leave the water. What is left
     is genuinely random — no station is reserved for the big island,
     which is what ordering the stations by capacity would have
     amounted to — and nothing can ever be laid on top of anything
     else. If a frame is too cramped for any draw at all, the islands
     stay in the row: the shuffle is what gives, not the layout.     */

  /* the water the islands may use: clear of the narration bar above
     and the HUD line below */
  var BAND = [0.17, 0.86];
  var SIDES = 0.02;                        /* air at each edge */
  /* Islands have to CLEAR each other, not merely not intersect.
     offsetWidth is a whole number of pixels while the real box is
     fractional, so a draw accepted at exactly touching can come out
     a fraction over — and on a small frame, where the gaps are
     proportionally tight, plenty of draws sit right at that line. */
  var CLEAR = 3;
  var STATION_X = [37, 63, 21, 50, 79];    /* two behind, three across */
  var DRAWS = 200;

  function shuffled(list) {
    var a = list.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* One island, measured: its box in px (offsetWidth is --k x --pu,
     and the box is square so that is both axes), and how far its
     painted silhouette reaches from its centre of area on each
     side — which is what has to fit, not the box. */
  function measure(pad) {
    var land = LAND[pad.dataset.shape];
    var w = pad.offsetWidth;
    return {
      pad: pad,
      left:  (land.cx - land.ext[0]) * w,
      right: (land.ext[2] - land.cx) * w,
      up:    (land.cy - land.ext[1]) * w,
      down:  (land.ext[3] - land.cy) * w
    };
  }

  function stations(sec, W, H) {
    var cs = global.getComputedStyle(sec);
    var far = parseFloat(cs.getPropertyValue('--far-y'));
    var land = parseFloat(cs.getPropertyValue('--land-y'));
    return STATION_X.map(function (x, i) {
      return { x: W * x / 100, y: H * (i < 2 ? far : land) / 100 };
    });
  }

  function collides(list, W, H) {
    var i, j, a, b;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.x - a.m.left < W * SIDES + CLEAR ||
          a.x + a.m.right > W * (1 - SIDES) - CLEAR ||
          a.y - a.m.up < H * BAND[0] + CLEAR ||
          a.y + a.m.down > H * BAND[1] - CLEAR) return true;
      for (j = i + 1; j < list.length; j++) {
        b = list[j];
        if (a.x - a.m.left - CLEAR < b.x + b.m.right &&
            b.x - b.m.left - CLEAR < a.x + a.m.right &&
            a.y - a.m.up - CLEAR < b.y + b.m.down &&
            b.y - b.m.up - CLEAR < a.y + a.m.down) return true;
      }
    }
    return false;
  }

  function scatter(round) {
    var sec = round.node;
    var W = sec.clientWidth;
    var H = sec.clientHeight;
    var pads = round.el.padList;

    function home() {
      pads.forEach(function (pad) { pad.classList.remove('is-scattered'); });
      round.el.reveal = REVEAL.map(function (i) { return pads[i]; });
    }

    if (!W || !H) { home(); return; }

    var art = pads.map(measure);
    var spots = stations(sec, W, H);
    var placed = null;

    for (var t = 0; t < DRAWS && !placed; t++) {
      var draw = shuffled(art).map(function (m, i) {
        return { m: m, x: spots[i].x, y: spots[i].y };
      });
      if (!collides(draw, W, H)) placed = draw;
    }

    if (!placed) { home(); return; }

    placed.forEach(function (o) {
      o.m.pad.style.setProperty('--sx', (o.x / W * 100).toFixed(3) + '%');
      o.m.pad.style.setProperty('--sy', (o.y / H * 100).toFixed(3) + '%');
      o.m.pad.classList.add('is-scattered');
    });

    /* and they surface back to front, left to right, so the
       archipelago comes out of the distance instead of in DOM order */
    round.el.reveal = placed.slice()
      .sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); })
      .map(function (o) { return o.m.pad; });
  }

  /* The three that matched go home to the row to be compared. Their
     row positions are the ones they were laid out at, so dropping
     the scatter is the whole move — and it is the LAYOUT that
     changes, not a transform, so padPlan() still reads the position
     each island is really at. `left`/`top` transition in
     css/rounds.css, which is what turns the change into a glide. */
  function regroup(round) {
    round.el.padList.forEach(function (pad) {
      if (pad.dataset.shape === round.shape) pad.classList.remove('is-scattered');
    });
  }


  /* ---------------------------------------------------------- markup */

  var BADGE =
    '<span class="topbar__badge" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24">' +
        '<path d="M12 2.2c2.7 2.8 4.1 6.3 4.1 9.8v3.4H7.9V12c0-3.5 1.4-7 4.1-9.8z" />' +
        '<path d="M7.9 12.4 5.1 15.3v3.4l2.8-2M16.1 12.4l2.8 2.9v3.4l-2.8-2" />' +
        '<path d="M10.2 15.8c0 2.2.7 4.1 1.8 5.4 1.1-1.3 1.8-3.2 1.8-5.4z" />' +
        '<circle cx="12" cy="9.2" r="1.7" />' +
      '</svg>' +
    '</span>';

  /* One island. `area` is null for a decoy: it never gets as far as
     the arithmetic, so it is never given a number to print. */
  function padHTML(shape, o) {
    var land = LAND[shape];

    var vars = [
      '--k:' + round2(o.k),
      '--pcx:' + land.cx,
      '--pcy:' + land.cy,
      '--rx:' + land.ring[0] + '%',
      '--ry:' + land.ring[1] + '%',
      '--rw:' + land.ring[2] + '%',
      '--ax:' + land.label[0] + '%',
      '--ay:' + land.label[1] + '%',
      '--clip:' + land.clip
    ].join(';');

    var name = land.adjective + ' landing zone';

    return '<div class="pad pad--' + o.slot + '" data-shape="' + shape + '"' +
                ' data-name="' + land.adjective + '"' +
                (o.area == null ? '' : ' data-area="' + o.area + '"') +
                ' style="' + vars + '">' +
      /* outside .pad__hit: that element is clipped to the island and
         would cut the whole ring away */
      '<span class="pad__ring" aria-hidden="true"></span>' +
      '<img class="pad__img" src="assets/images/' + encodeURI(land.img) + '" alt="" />' +
      '<svg class="pad__fit" viewBox="0 0 100 100" aria-hidden="true">' +
        '<path d="' + land.outline + '" />' +
      '</svg>' +
      (o.area == null ? ''
        : '<p class="pad__area"><b>' + o.area + '</b><i>sq units</i></p>') +
      /* where the burst comes from when this island is picked. A
         sibling of the hit target, not a child of it: that one is
         clipped to the coastline, and a burst is meant to leave the
         island. M.burst() fills it and empties it again. */
      '<span class="pad__pop" aria-hidden="true"></span>' +
      '<button class="pad__hit" type="button" tabindex="-1" aria-label="' + name + '"></button>' +
    '</div>';
  }

  function sectionHTML(round) {
    var land = LAND[round.shape];
    var craft = CRAFT[round.shape];

    var kFit = boxFor(FIT_AREA, land);
    var fit = Math.sqrt(land.fill / craft.fill);

    var pads = [];

    /* decoys first, so they paint behind the row that matters */
    round.decoys.forEach(function (shape, i) {
      pads.push(padHTML(shape, {
        k: boxFor(DECOY_AREA, LAND[shape]),
        slot: 'far' + (i + 1),
        area: null
      }));
    });

    round.row.forEach(function (area, i) {
      pads.push(padHTML(round.shape, {
        k: kFit * Math.sqrt(area / round.area),
        slot: 'row' + (i + 1),
        area: area
      }));
    });

    var vars = [
      '--ship-k:' + round2(kFit * fit),
      '--scx:' + craft.cx,
      '--scy:' + craft.cy
    ].join(';');

    return '<section class="screen screen--round" data-shape="' + round.shape +
                   '" style="' + vars + '">' +

      '<div class="layer layer--bg s3-bg" aria-hidden="true"></div>' +

      '<div class="ship">' +
        '<div class="ship__craft">' +
          '<img class="ship__img" src="assets/images/' + encodeURI(craft.img) +
               '" alt="' + craft.alt + '" />' +
          '<svg class="ship__dims" viewBox="-28 -6 132 132" aria-hidden="true">' +
            craft.dims +
          '</svg>' +
        '</div>' +
      '</div>' +

      '<div class="pads">' + pads.join('') + '</div>' +

      '<div class="splash" aria-hidden="true">' +
        '<span class="splash__foam"></span>' +
        '<span class="splash__ring"></span>' +
        '<span class="splash__ring splash__ring--b"></span>' +
      '</div>' +

      '<div class="crash" aria-hidden="true">' +
        '<span class="crash__flash"></span>' +
        '<span class="crash__dust"></span>' +
        '<span class="crash__ring"></span>' +
        '<span class="crash__ring crash__ring--b"></span>' +
      '</div>' +

      '<div class="confetti" aria-hidden="true"></div>' +

      '<div class="hud">' +
        '<p class="hud__caption" role="status" aria-live="polite"></p>' +
        '<p class="hud__tally" role="status" aria-live="polite"></p>' +
      '</div>' +

      '<header class="topbar">' +
        '<div class="topbar__frame">' + BADGE +
          '<p class="topbar__text" role="status" aria-live="polite"></p>' +
        '</div>' +
      '</header>' +

      '<div class="advance">' +
        '<button class="advance__btn" type="button" hidden>' +
          '<span class="advance__label">NEXT</span>' +
          '<svg class="advance__arrow" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="m9 5 7 7-7 7" /></svg>' +
        '</button>' +
      '</div>' +

    '</section>';
  }


  /* ---------------------------------------------------------- build
     Called once, at load, from the bottom of the document — so the
     islands and the craft are in `document.images` before the start
     gate counts what it has to wait for, and the round screens are
     covered by the loading bar like everything else.

     Each round comes back with its elements already looked up (there
     are no ids on these screens: five copies of one screen cannot
     each own an id, and the flow is handed the round it is playing
     anyway) and with the four figures padPlan() needs.             */
  function build(stage, before) {
    if (!stage) return [];

    return ROUNDS.map(function (round) {
      var host = doc.createElement('div');
      host.innerHTML = sectionHTML(round);

      var node = host.firstChild;
      stage.insertBefore(node, before || null);

      var land = LAND[round.shape];
      var craft = CRAFT[round.shape];
      var pads = Array.prototype.slice.call(node.querySelectorAll('.pad'));

      round.node = node;
      round.el = {
        ship: node.querySelector('.ship'),
        shipCraft: node.querySelector('.ship__craft'),
        shipDims: node.querySelector('.ship__dims'),
        pads: node.querySelector('.pads'),
        padList: pads,
        /* the order they surface in, near and far alternating */
        reveal: REVEAL.map(function (i) { return pads[i]; }),
        splash: node.querySelector('.splash'),
        crash: node.querySelector('.crash'),
        confetti: node.querySelector('.confetti'),
        hud: node.querySelector('.hud'),
        caption: node.querySelector('.hud__caption'),
        tally: node.querySelector('.hud__tally'),
        topbar: node.querySelector('.topbar'),
        topbarText: node.querySelector('.topbar__text'),
        advance: node.querySelector('.advance__btn')
      };

      /* what the fall arithmetic in js/animation.js runs on */
      round.geo = {
        shipCX: craft.cx, shipCY: craft.cy,
        padCX: land.cx, padCY: land.cy,
        fit: Math.sqrt(land.fill / craft.fill)
      };

      return round;
    });
  }

  global.GeoPages = {
    build: build, scatter: scatter, regroup: regroup,
    rounds: ROUNDS, land: LAND, craft: CRAFT
  };
})(window);
