/** A client account in the agency's book of business (mock). */
export interface ClientAccount {
  id: string;
  name: string;
  industry: string;
  spend: string;
  roas: string;
  cpa: string;
  status: "healthy" | "watch" | "critical";
  /** headline issue when the client needs attention */
  alert?: string;
  /** question opened when you click into the client (resolves to a scenario) */
  question: string;
}

export const AGENCY_CLIENTS: ClientAccount[] = [
  {
    id: "northwind",
    name: "Northwind Co.",
    industry: "E-commerce",
    spend: "€48.2k",
    roas: "3.8×",
    cpa: "€31",
    status: "critical",
    alert: "CPA up 18% — mobile conversion drop",
    question: "Why is my CPA going up?",
  },
  {
    id: "brightside",
    name: "Brightside DTC",
    industry: "DTC beauty",
    spend: "€23.4k",
    roas: "2.9×",
    cpa: "€41",
    status: "critical",
    alert: "Meta Pixel dropping 31% of purchases",
    question: "Do I have a tracking problem?",
  },
  {
    id: "lumen",
    name: "Lumen SaaS",
    industry: "B2B SaaS",
    spend: "€72.0k",
    roas: "4.1×",
    cpa: "€38",
    status: "watch",
    alert: "Meta ROAS −18% month-over-month",
    question: "Which platform is performing best?",
  },
  {
    id: "astra",
    name: "Astra Travel",
    industry: "Travel",
    spend: "€61.5k",
    roas: "3.4×",
    cpa: "€52",
    status: "watch",
    alert: "Branded-search overspend",
    question: "Where am I wasting ad spend this month?",
  },
  {
    id: "vertex",
    name: "Vertex Retail",
    industry: "Retail",
    spend: "€150k",
    roas: "4.6×",
    cpa: "€24",
    status: "healthy",
    question: "Where am I wasting ad spend this month?",
  },
  {
    id: "quanta",
    name: "Quanta Fitness",
    industry: "Fitness",
    spend: "€12.1k",
    roas: "5.2×",
    cpa: "€19",
    status: "healthy",
    question: "Which platform is performing best?",
  },
];
