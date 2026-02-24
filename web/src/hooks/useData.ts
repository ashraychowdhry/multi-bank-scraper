import { useState, useEffect } from "react";
import type { ScrapeResult } from "@shared/types";

// Normalize data from older formats that may lack `institution` or `holdings` fields
function normalize(raw: Record<string, unknown>): ScrapeResult {
  const data = raw as unknown as ScrapeResult;
  return {
    scrapedAt: data.scrapedAt,
    accounts: (data.accounts || []).map((a) => ({
      ...a,
      institution: a.institution || "chase",
    })),
    transactions: (data.transactions || []).map((t) => ({
      ...t,
      institution: t.institution || "chase",
    })),
    holdings: (data.holdings || []).map((h) => ({
      ...h,
      institution: h.institution || "unknown",
      accountName: h.accountName || `${(h.institution || "unknown").charAt(0).toUpperCase() + (h.institution || "unknown").slice(1)} Account`,
    })),
    cashInterest: data.cashInterest,
    stockLending: data.stockLending,
    offers: data.offers,
    amexOffers: data.amexOffers,
    amexCardDetails: data.amexCardDetails,
    capitalOneCards: data.capitalOneCards,
    capitalOneOffers: data.capitalOneOffers,
    capitalOneRewards: data.capitalOneRewards,
  };
}

export function useData() {
  const [data, setData] = useState<ScrapeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setData(normalize(json)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}
