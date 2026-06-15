Left Nav Bar — UI & Behavior Spec (Mirror Actioneer)

1. Layout & Sizing
Overall structure:
The page root is a flex h-screen overflow-hidden container with 3 direct children: <aside> (the sidebar), a 1px-wide <button> (the resizable edge/collapse trigger), and the main content <div>.
Expanded sidebar:

Width: 255px
Background color: CSS var bg-sidebar (warm off-white, e.g. oklch(93% 0.01 75))
No border on the right — the border is handled by the edge button (see Section 2)
Transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1) (smooth width animation on collapse/expand)
overflow: hidden (content clips during animation)

Collapsed sidebar:

Width: 56px
Shows only a vertical column of icons (no labels)
Two absolutely-positioned layers inside <aside>:

Icon-only layer (opacity-100 when collapsed, opacity-0 when expanded): absolute inset-0 flex flex-col items-center pt-5 pb-3 pl-2.5 gap-1 transition-opacity duration-200 ease-in-out
Full expanded layer (opacity-0 when collapsed, opacity-100 with delay-100 when expanded): absolute inset-0 flex flex-col w-[255px] transition-opacity duration-200 ease-in-out




2. The Edge / Collapse-Expand Button (The Border Line)
This is the single most important interaction. The divider between the sidebar and main content is not a CSS border — it is a standalone <button> element placed between the sidebar and main content in the flex layout.
Structure:
html<button
  class="group/edge relative w-px shrink-0 cursor-pointer z-20"
  aria-label="Collapse sidebar"  <!-- becomes "Expand sidebar" when collapsed -->
  onMouseMove={handleMouseMove}
  onMouseLeave={handleMouseLeave}
  onClick={toggleSidebar}
>
  <!-- Hit area expansion: makes the 1px button easier to hover -->
  <div class="absolute inset-y-0 -left-2 -right-2" />

  <!-- Radix Tooltip wrapping the floating circle indicator -->
  <Tooltip delayDuration={400}>
    <TooltipTrigger asChild>
      <div
        class="absolute rounded-full border border-border bg-card shadow-md flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          top: mouseY,      /* tracks mouse Y position via onMouseMove */
          right: -18,       /* positions circle centered on the edge line */
          pointerEvents: "auto",
        }}
      >
        <!-- Left-pointing chevron (ChevronLeft icon, 18px) when expanded -->
        <!-- Right-pointing chevron (ChevronRight icon, 18px) when collapsed -->
        <svg ... className="text-foreground" />
      </div>
    </TooltipTrigger>
    <TooltipContent side="right" sideOffset={8}>
      Collapse sidebar   <!-- or "Expand sidebar" when collapsed -->
    </TooltipContent>
  </Tooltip>
</button>
Visual behavior of the edge line:

At rest: The 1px wide button has background: transparent — it is visually invisible, meaning there is only a single thin implicit boundary between sidebar and main. No border or shadow is rendered at rest.
On hover: The 1px button body becomes colored (via Tailwind hover:bg-border or equivalent), rendering as a thin 1px colored line.
The circular button (36×36px, rounded-full, border border-border, bg-card, shadow-md) appears at the exact Y position of the cursor, positioned with right: -18px so it straddles the edge line (half inside sidebar, half outside).
The circle contains a ChevronLeft icon (18px, text-foreground) when expanded, or ChevronRight when collapsed.
The circle position slides along the border as the mouse moves — implement this with onMouseMove tracking event.clientY - buttonRect.top and storing as state, applied as style={{ top: mouseY }}.
A tooltip label ("Collapse sidebar" / "Expand sidebar") appears to the right of the circle with side="right", sideOffset={8}, with delayDuration={400}ms.
On onMouseLeave, reset the circle back to a default Y position (e.g. top: 50%).
Clicking anywhere along this button collapses or expands the sidebar.


3. Section Header Row (Menu Items with Children)
There are two types of section headers:
Type A — Link + Separate Toggle Arrow (e.g. Metrics, Boards, Segments)
html<div class="flex items-center group/grphdr rounded-md hover:bg-foreground/[0.06] transition-colors">
  
  <!-- Clicking the link area navigates to the section page -->
  <a
    href="/metrics"
    class="flex-1 min-w-0 flex items-center gap-3 px-2.5 py-2 text-left"
  >
    <SectionIcon class="w-[18px] h-[18px] text-muted-foreground shrink-0" />
    <span class="text-[13px] text-foreground">Metrics</span>
  </a>

  <!-- Clicking the arrow ONLY toggles the child list, does NOT navigate -->
  <button
    aria-label="Toggle Metrics list"
    class="relative w-7 h-7 mr-1 flex items-center justify-center rounded
           group-hover/grphdr:bg-foreground/[0.06]
           hover:!bg-foreground/[0.12]
           transition-colors shrink-0"
  >
    <!-- ChevronDown icon, rotated -90deg when closed (pointing right), 0deg when open (pointing down) -->
    <ChevronDown
      class="w-3.5 h-3.5 text-muted-foreground transition-transform duration-200
             [closed state: -rotate-90]  [open state: no rotation]"
    />
  </button>

</div>
Key behaviors:

The entire row has a single shared hover background (hover:bg-foreground/[0.06] ≈ 6% black) using Tailwind group/grphdr.
When the row is hovered, the toggle button gets a light background (bg-foreground/[0.06] = 6% black).
When the toggle button itself is hovered directly, it gets a slightly stronger background (bg-foreground/[0.12] = 12% black, marked !important to override the group hover).
The chevron icon transitions smoothly between -rotate-90 (pointing right = closed) and rotate-0 (pointing down = open) with transition-transform duration-200.
Clicking the link area → navigates to the section's main page (does NOT toggle children).
Clicking the toggle button → toggles the child list open/closed (does NOT navigate).

Type B — Button-only header (e.g. All Chats — no page link, just expand/collapse)
html<div class="flex items-center group/grphdr">
  <button class="flex-1 flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-foreground/[0.06] transition-colors text-left">
    <SectionIcon class="w-[18px] h-[18px] text-muted-foreground shrink-0" />
    <span class="text-[13px] text-foreground flex-1">All Chats</span>
    <!-- Chevron is INSIDE the button (no separate toggle button) -->
    <ChevronDown class="w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 [rotate on toggle]" />
  </button>
</div>
Section header row metrics:

Row height: ~36px
Row border-radius: 8px (rounded-md)
Icon: 18×18px, color text-muted-foreground
Label font: 13px, normal weight, color text-foreground
Toggle button: 28×28px (w-7 h-7), border-radius: 4px (rounded), right margin mr-1
Chevron size: 14×14px (w-3.5 h-3.5)


4. Child / Sub-Item Rows
html<button
  class="flex-1 min-w-0 pl-4 py-1.5 text-[13px] text-left truncate transition-colors cursor-pointer
         text-muted-foreground hover:text-foreground"
>
  Item label
</button>
Metrics:

Height: ~32px
Padding left: 16px (indented from parent)
Padding top/bottom: 6px
Font: 13px, color text-muted-foreground at rest → text-foreground on hover
No background change on hover — only text color changes
Text truncates with ellipsis if too long


5. Sidebar Internal Layout Structure (Expanded)
<aside> (255px wide, bg-sidebar)
  └── absolute container (inset-0, flex-col)
      ├── Header area (flex items-center gap-2 px-4 pt-4 pb-3)
      │   ├── Logo/icon (shrink-0)
      │   └── App name + workspace selector (flex-1 min-w-0)
      │
      ├── CTA button area (px-4 mt-2 mb-3)
      │   └── "+ New chat" button
      │
      ├── <nav> (flex-1 overflow-y-auto px-3 space-y-1)  ← scrollable
      │   ├── Section group 1 (All Chats) + children
      │   ├── Section group 2 (Metrics) + children
      │   ├── Section group 3 (Boards) + children
      │   └── ...
      │
      └── Bottom bar (px-3 pb-3 mt-auto)
          ├── <div class="mx-1 mb-2 border-t border-border" />  ← horizontal separator line
          ├── Data link
          ├── Settings link
          └── Account button
Nav spacing: space-y-1 = 4px gap between section groups.
Nav padding: px-3 horizontal, overflow-y-auto for scroll.

6. Summary of Key Behavioral Rules
BehaviorSpecSidebar-to-content dividerSingle 1px transparent button; becomes visible line on hoverCollapse/expand triggerMouse hovering anywhere along the 1px button heightCircle indicator36×36px rounded pill; appears at cursor's Y position; slides with mouseCircle iconChevronLeft when expanded sidebar, ChevronRight when collapsedTooltipAppears to the right of circle, text = "Collapse sidebar" / "Expand sidebar", delay 400msToggle arrow directionChevronDown rotated -90deg = closed (right), 0deg = open (down)Toggle arrow on row hoverToggle button receives bg-foreground/6% background when row is hoveredToggle arrow on direct hoverToggle button receives bg-foreground/12% background when button itself is hoveredClicking section name/iconNavigates to section page (does NOT collapse/expand children)Clicking toggle arrowCollapses/expands children (does NOT navigate)Child item hoverText color changes muted → foreground; no background changeSidebar collapse animationwidth transition 200ms ease-in-out; two opacity layers cross-fade with delay-100 on expandCollapsed sidebar contentIcon-only column, 56px wide, icons centered at 40×40px each