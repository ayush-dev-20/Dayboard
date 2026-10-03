import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Inbox,
  ListChecks,
  Lock,
  Sun,
  Target,
  Trash2,
  ToggleLeft,
} from "lucide-react";
import { BrandLockup } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { LandingThemeToggle } from "./landing-theme-toggle";
import { ProductFrame } from "./product-frame";
import { Screenshot } from "./screenshot";

// The landing page's sections (feature 07 §10.3). Every claim here is true of the product today.
// There is no social proof, no user count and no pricing: Dayboard has none to show yet (§10.2).

const container = "mx-auto w-full max-w-landing px-4 md:px-6";

function SectionHeading({
  eyebrow,
  title,
  intro,
  id,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  id: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="type-label-caps text-primary">{eyebrow}</p>
      <h2
        id={id}
        className="mt-3 type-headline-lg text-foreground md:text-[36px] md:leading-[1.15]"
      >
        {title}
      </h2>
      {intro ? <p className="mt-3 type-body-lg text-muted-foreground">{intro}</p> : null}
    </div>
  );
}

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden pt-32 pb-12 md:pt-40 md:pb-20"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(60%_55%_at_50%_30%,var(--landing-wash)_0%,transparent_75%)]"
      />
      <div className={cn(container, "relative text-center")}>
        <h1
          id="hero-title"
          className="mx-auto max-w-3xl type-hero text-foreground motion-safe:animate-[fade-up_400ms_var(--ease-enter)_both]"
        >
          Capture anything. Act on what matters.
        </h1>
        <p className="mx-auto mt-5 max-w-xl type-body-lg text-muted-foreground motion-safe:animate-[fade-up_400ms_var(--ease-enter)_60ms_both]">
          Dayboard is a calm personal workspace for tasks, todos, notes and projects: one page for
          today, one key to capture, and AI that asks before it changes anything.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 motion-safe:animate-[fade-up_400ms_var(--ease-enter)_120ms_both]">
          <Link href="/sign-up" className={cn(buttonVariants(), "h-11 px-5 type-label-md")}>
            Get started <ArrowRight strokeWidth={1.5} aria-hidden />
          </Link>
          <a href="#how" className={cn(buttonVariants({ variant: "secondary" }), "h-11 px-5")}>
            See how it works
          </a>
        </div>
        <ProductFrame
          name="today"
          priority
          alt="The Today page in Dayboard: a greeting with today's progress, a capture box, the day's focus with three suggested tasks, a one-line AI brief, the overdue tasks, and a side column with recent notes and the inbox."
          sizes="(min-width: 1152px) 1104px, 100vw"
          className="mx-auto mt-14 max-w-5xl text-left motion-safe:animate-[fade-up_400ms_var(--ease-enter)_180ms_both]"
        />
      </div>
    </section>
  );
}

const LOOP = [
  {
    icon: Inbox,
    step: "Capture",
    text: "Press C anywhere and type. It lands in your Inbox, sorted later.",
    image: "loop-capture",
    alt: "The capture box on Today, with its C shortcut hint.",
  },
  {
    icon: ListChecks,
    step: "Organize",
    text: "Turn thoughts into tasks, todos, notes or projects when you're ready.",
    image: "loop-organize",
    alt: "A group of overdue tasks with due dates, priority and projects.",
  },
  {
    icon: Target,
    step: "Execute",
    text: "Pick one focus for the day and see what is due, nothing more.",
    image: "loop-execute",
    alt: "The focus card on Today suggesting three tasks to focus on.",
  },
  {
    icon: Sun,
    step: "Review",
    text: "Projects show progress and what's next, so nothing slips.",
    image: "loop-review",
    alt: "A project card with its color, progress bar, counts and the next due task.",
  },
] as const;

export function Loop() {
  return (
    <section
      aria-labelledby="how-title"
      id="how"
      className="scroll-mt-28 border-t border-border py-20 md:py-28"
    >
      <div className={container}>
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="Capture, organize, execute, review."
          intro="The whole loop, each step one screen away. Nothing to set up first."
        />
        <ol className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {LOOP.map(({ icon: Icon, step, text, image, alt }, i) => (
            <li key={step} className="flex flex-col card p-5">
              <p className="flex items-center gap-2 type-label-md text-foreground">
                <span className="flex size-7 items-center justify-center rounded-md bg-primary-subtle text-primary">
                  <Icon className="size-4" strokeWidth={1.5} aria-hidden />
                </span>
                <span className="type-data-sm text-muted-foreground">{i + 1}</span>
                {step}
              </p>
              <p className="mt-3 type-body-md text-muted-foreground">{text}</p>
              <div className="mt-auto pt-5">
                <div className="overflow-hidden rounded-lg border border-border bg-background">
                  <Screenshot
                    name={image}
                    alt={alt}
                    sizes="(min-width: 1280px) 260px, (min-width: 768px) 45vw, 90vw"
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    title: "Today and Focus",
    text: "The first page of your day: a greeting, how far along you are, and the one thing you chose to focus on.",
    bullets: [
      "Progress counts what was due today, never your backlog",
      "Overdue is calm: one alarm, not a wall of red",
      "A short daily brief, only if you turn AI on",
    ],
    image: "today",
    alt: "The Today page with a progress ring, the focus card and the overdue section.",
  },
  {
    title: "Tasks and Todos",
    text: "Tasks carry the weight: subtasks, priority, start and due dates, repeats. Todos are the quick tick-offs.",
    bullets: [
      "Square boxes for tasks, round ones for todos",
      "Change a due date or priority right from the row",
      "Keyboard first: N, T, arrows and Space",
    ],
    image: "tasks",
    alt: "The Tasks list grouped into Overdue, Today, Upcoming and No date.",
  },
  {
    title: "Notes, projects and links",
    text: "Notes autosave as you type and never overwrite a change made in another window. Projects pull it all together.",
    bullets: [
      "Rich notes with headings, lists and checklists",
      "Link notes and tasks both ways",
      "Projects show progress and the next due task",
    ],
    image: "notes",
    alt: "Notes shown as a grid of cards with titles, previews, tags and projects.",
  },
  {
    title: "⌘K search and Ask, with sources",
    text: "One menu searches everything, creates anything, and answers questions from your own workspace.",
    bullets: [
      "Find tasks, notes and projects as you type",
      "Ask in plain words; answers use only your workspace",
      "Every answer links to the records it came from",
    ],
    image: "ask",
    alt: "The command menu in Ask mode with an answer, a quote from a note and links to its sources.",
  },
] as const;

export function FeatureRows() {
  return (
    <section
      aria-labelledby="features-title"
      id="features"
      className="scroll-mt-28 border-t border-border py-20 md:py-28"
    >
      <div className={container}>
        <SectionHeading
          id="features-title"
          eyebrow="Features"
          title="Everything a day needs, in one quiet place."
        />
        <div className="mt-16 flex flex-col gap-20 md:gap-28">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className="grid items-center gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-14"
            >
              <div className={cn(i % 2 === 1 && "md:order-2")}>
                <h3 className="type-headline-md text-foreground">{f.title}</h3>
                <p className="mt-3 type-body-lg text-muted-foreground">{f.text}</p>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 type-body-md text-foreground">
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        strokeWidth={2}
                        aria-hidden
                      />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <ProductFrame
                name={f.image}
                alt={f.alt}
                sizes="(min-width: 1152px) 640px, 100vw"
                className={cn(i % 2 === 1 && "md:order-1")}
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AiFirst() {
  const points = [
    "Nothing is created or changed until you click to confirm.",
    "Each action sends only what it needs, and prompts and answers aren't stored.",
    "Turn AI off in Settings at any time; everything else keeps working.",
  ];
  return (
    <section aria-labelledby="ai-title" className="border-t border-border py-20 md:py-28">
      <div className={cn(container, "grid items-center gap-10 md:grid-cols-2 md:gap-14")}>
        <div>
          <SectionHeading
            id="ai-title"
            eyebrow="AI that asks first"
            title="Suggestions you review, never changes you didn't make."
            intro="Turn a messy note into tasks, break a task into steps, or tidy what's overdue. You see a preview first, edit anything, and decide."
          />
          <ul className="mt-6 flex flex-col gap-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 type-body-md text-foreground">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  strokeWidth={2}
                  aria-hidden
                />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-[radial-gradient(70%_70%_at_50%_40%,var(--landing-wash)_0%,transparent_75%)] p-2 md:p-6">
          <div className="overflow-hidden rounded-xl border border-border shadow-md">
            <Screenshot
              name="ai-preview"
              alt="An AI preview listing the tasks found in a captured note, each with a checkbox, an editable title and a due date, and a Create tasks button."
              sizes="(min-width: 768px) 520px, 100vw"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function KeyboardStrip() {
  const keys = [
    { k: "⌘K", label: "Search, ask or create" },
    { k: "C", label: "Capture to Inbox" },
    { k: "N", label: "New task" },
    { k: "T", label: "New todo" },
  ];
  return (
    <section aria-labelledby="keys-title" className="border-t border-border py-14">
      <div
        className={cn(
          container,
          "flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between",
        )}
      >
        <h2 id="keys-title" className="type-headline-sm text-foreground">
          Keyboard first, everywhere.
        </h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-3">
          {keys.map(({ k, label }) => (
            <li key={k} className="flex items-center gap-2 type-body-md text-muted-foreground">
              <Kbd className="inline-flex h-7 min-w-7 items-center justify-center px-2 type-label-md">
                {k}
              </Kbd>{" "}
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Privacy() {
  const items = [
    {
      icon: Lock,
      title: "Your data is yours alone",
      text: "Every task, note and project is visible only to you. Nothing is shared or public.",
    },
    {
      icon: Trash2,
      title: "Delete your account any time",
      text: "From Settings, in a couple of clicks. Your data goes with it.",
    },
    {
      icon: ToggleLeft,
      title: "Turn AI off any time",
      text: "One switch hides every AI button. The rest of Dayboard is unchanged.",
    },
  ];
  return (
    <section aria-labelledby="privacy-title" className="border-t border-border py-20 md:py-28">
      <div className={container}>
        <SectionHeading
          id="privacy-title"
          eyebrow="Privacy and control"
          title="Built to be trusted with your day."
        />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {items.map(({ icon: Icon, title, text }) => (
            <li key={title} className="card p-5">
              <Icon className="size-5 text-primary" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-4 type-headline-sm text-foreground">{title}</h3>
              <p className="mt-2 type-body-md text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: "What is Dayboard?",
    a: "A personal workspace for the things you need to do and remember: tasks, quick todos, notes and projects, with a Today page that shows only what matters now.",
  },
  {
    q: "Does the AI change my things on its own?",
    a: "No. Every AI action shows a preview first. Nothing is created or changed until you click the button that confirms it.",
  },
  {
    q: "What does the AI see?",
    a: "Only the minimum content for the action you start, such as the one note you asked to summarize. Prompts and answers aren't stored, except inbox suggestions and the daily suggestion.",
  },
  {
    q: "Can I use Dayboard without AI?",
    a: "Yes. Turn it off in Settings and every AI button disappears. Everything else works exactly the same.",
  },
  {
    q: "How much does it cost?",
    a: "There are no paid plans in this version of Dayboard.",
  },
  {
    q: "Can I delete my account?",
    a: "Yes, from Settings → Account. Your data is deleted with it; backups may keep a copy until they rotate out.",
  },
];

export function Faq() {
  return (
    <section
      aria-labelledby="faq-title"
      id="faq"
      className="scroll-mt-28 border-t border-border py-20 md:py-28"
    >
      <div className={cn(container, "grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]")}>
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered." />
        <div className="border-t border-border">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group border-b border-border">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 type-body-lg text-foreground [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  strokeWidth={1.5}
                  aria-hidden
                />
              </summary>
              <p className="pb-5 type-body-md text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="px-4 pb-20 md:pb-28">
      <div className="relative mx-auto max-w-landing overflow-hidden rounded-xl border border-border bg-card px-6 py-14 text-center shadow-xs md:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_100%,var(--landing-wash)_0%,transparent_70%)]"
        />
        <div className="relative">
          <h2
            id="cta-title"
            className="type-headline-lg text-foreground md:text-[36px] md:leading-[1.15]"
          >
            Start your day on one calm page.
          </h2>
          <p className="mx-auto mt-3 max-w-md type-body-lg text-muted-foreground">
            Create an account with email, Google or GitHub. It takes a minute.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className={cn(buttonVariants(), "h-11 px-5")}>
              Get started <ArrowRight strokeWidth={1.5} aria-hidden />
            </Link>
            <Link
              href="/sign-in"
              className={cn(buttonVariants({ variant: "secondary" }), "h-11 px-5")}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  const columns = [
    {
      title: "Product",
      links: [
        { href: "/#features", label: "Features" },
        { href: "/#how", label: "How it works" },
        { href: "/#faq", label: "FAQ" },
      ],
    },
    {
      title: "Account",
      links: [
        { href: "/sign-in", label: "Sign in" },
        { href: "/sign-up", label: "Get started" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ],
    },
  ];
  return (
    <footer className="border-t border-border bg-sidebar py-14">
      <div
        className={cn(
          container,
          "grid gap-10 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]",
        )}
      >
        <div className="flex flex-col items-start gap-4">
          <BrandLockup />
          <p className="max-w-xs type-body-sm text-muted-foreground">
            A calm personal workspace for tasks, todos, notes and projects.
          </p>
          <LandingThemeToggle />
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className="type-label-caps text-muted-foreground">{col.title}</p>
            <ul className="mt-3 flex flex-col gap-1">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-flex h-9 items-center type-body-md text-foreground hover:text-primary"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className={cn(container, "mt-12 type-body-sm text-muted-foreground")}>© 2026 Dayboard</p>
    </footer>
  );
}
