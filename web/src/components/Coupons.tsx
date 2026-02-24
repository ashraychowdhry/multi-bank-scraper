import { useState, useMemo } from "react";
import type { ScrapeResult, ChaseOffer, AmexOffer, CapitalOneOffer } from "@shared/types";

type OfferFilter = "all" | "activated" | "available" | "expiring";

export function Coupons({ data }: { data: ScrapeResult }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<OfferFilter>("all");

  const chaseOffers = data.offers || [];
  const amexOffers = data.amexOffers || [];
  const capitalOneOffers = data.capitalOneOffers || [];

  const filteredChase = useMemo(() => {
    let offers = [...chaseOffers];
    if (search) {
      const q = search.toLowerCase();
      offers = offers.filter(
        (o) => o.merchant.toLowerCase().includes(q) || o.reward.toLowerCase().includes(q)
      );
    }
    if (filter === "activated") offers = offers.filter((o) => o.isActivated);
    else if (filter === "available") offers = offers.filter((o) => !o.isActivated && !o.isExpiringSoon);
    else if (filter === "expiring") offers = offers.filter((o) => o.isExpiringSoon && !o.isActivated);
    return offers;
  }, [chaseOffers, search, filter]);

  const filteredAmex = useMemo(() => {
    let offers = [...amexOffers];
    if (search) {
      const q = search.toLowerCase();
      offers = offers.filter(
        (o) => o.merchant.toLowerCase().includes(q) || o.description.toLowerCase().includes(q)
      );
    }
    if (filter === "activated") offers = offers.filter((o) => o.isAdded);
    else if (filter === "available") offers = offers.filter((o) => !o.isAdded);
    else if (filter === "expiring") offers = offers.filter((o) => !o.isAdded && o.expiresAt);
    return offers;
  }, [amexOffers, search, filter]);

  const filteredCapitalOne = useMemo(() => {
    let offers = [...capitalOneOffers];
    if (search) {
      const q = search.toLowerCase();
      offers = offers.filter(
        (o) => o.merchant.toLowerCase().includes(q) || o.description.toLowerCase().includes(q)
      );
    }
    if (filter === "activated") offers = offers.filter((o) => o.isAdded);
    else if (filter === "available") offers = offers.filter((o) => !o.isAdded);
    else if (filter === "expiring") offers = offers.filter((o) => !o.isAdded && o.expiresAt);
    return offers;
  }, [capitalOneOffers, search, filter]);

  const totalOffers = chaseOffers.length + amexOffers.length + capitalOneOffers.length;
  const totalFiltered = filteredChase.length + filteredAmex.length + filteredCapitalOne.length;

  if (totalOffers === 0) {
    return (
      <div className="coupons-tab">
        <div className="coupons-empty">No offers available. Run scraper with Chase, Amex, or Capital One to load offers.</div>
      </div>
    );
  }

  return (
    <div className="coupons-tab">
      {/* Controls */}
      <div className="coupons-controls">
        <input
          type="text"
          placeholder="Search offers by merchant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="filter-search"
        />
        <div className="coupons-filter-pills">
          {(["all", "activated", "available", "expiring"] as OfferFilter[]).map((f) => (
            <button
              key={f}
              className={`coupon-filter-pill ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="coupons-info">
        {totalFiltered} of {totalOffers} offers
        {(search || filter !== "all") && " — filtered"}
      </div>

      {/* Chase Offers */}
      {filteredChase.length > 0 && (
        <section className="coupons-section">
          <h2 className="section-title">
            <span className="institution-dot chase" />
            Chase Offers ({filteredChase.length})
          </h2>
          <div className="coupons-grid">
            {filteredChase.map((o, i) => (
              <ChaseOfferCard key={`chase-${o.merchant}-${i}`} offer={o} />
            ))}
          </div>
        </section>
      )}

      {/* Amex Offers */}
      {filteredAmex.length > 0 && (
        <section className="coupons-section">
          <h2 className="section-title">
            <span className="institution-dot amex" />
            Amex Offers ({filteredAmex.length})
          </h2>
          <div className="coupons-grid">
            {filteredAmex.map((o, i) => (
              <AmexOfferCard key={`amex-${o.merchant}-${i}`} offer={o} />
            ))}
          </div>
        </section>
      )}

      {/* Capital One Offers */}
      {filteredCapitalOne.length > 0 && (
        <section className="coupons-section">
          <h2 className="section-title">
            <span className="institution-dot capitalone" />
            Capital One Offers ({filteredCapitalOne.length})
          </h2>
          <div className="coupons-grid">
            {filteredCapitalOne.map((o, i) => (
              <CapitalOneOfferCard key={`capitalone-${o.merchant}-${i}`} offer={o} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ChaseOfferCard({ offer }: { offer: ChaseOffer }) {
  return (
    <div className={`coupon-card ${offer.isActivated ? "activated" : ""} ${offer.isExpiringSoon ? "expiring" : ""}`}>
      <div className="coupon-card-top">
        <span className="coupon-merchant">{offer.merchant}</span>
        <span className={`coupon-status ${offer.isActivated ? "added" : offer.isExpiringSoon ? "expiring" : "available"}`}>
          {offer.isActivated ? "Added" : offer.isExpiringSoon ? "Expiring" : "Available"}
        </span>
      </div>
      <div className="coupon-reward">{offer.reward}</div>
      {offer.daysLeft && (
        <div className="coupon-expiry">{offer.daysLeft}</div>
      )}
      <div className="coupon-source">{offer.accountName}</div>
    </div>
  );
}

function AmexOfferCard({ offer }: { offer: AmexOffer }) {
  return (
    <div className={`coupon-card ${offer.isAdded ? "activated" : ""}`}>
      <div className="coupon-card-top">
        <span className="coupon-merchant">{offer.merchant}</span>
        <span className={`coupon-status ${offer.isAdded ? "added" : "available"}`}>
          {offer.isAdded ? "Added" : "Available"}
        </span>
      </div>
      <div className="coupon-reward">{offer.description}</div>
      {offer.expiresAt && (
        <div className="coupon-expiry">Expires {offer.expiresAt}</div>
      )}
      {offer.rewardAmount && (
        <div className="coupon-amount">{offer.rewardAmount}</div>
      )}
    </div>
  );
}

function CapitalOneOfferCard({ offer }: { offer: CapitalOneOffer }) {
  return (
    <div className={`coupon-card ${offer.isAdded ? "activated" : ""}`}>
      <div className="coupon-card-top">
        <span className="coupon-merchant">{offer.merchant}</span>
        <span className={`coupon-status ${offer.isAdded ? "added" : "available"}`}>
          {offer.isAdded ? "Added" : "Available"}
        </span>
      </div>
      <div className="coupon-reward">{offer.description}</div>
      {offer.expiresAt && (
        <div className="coupon-expiry">Expires {offer.expiresAt}</div>
      )}
      {offer.rewardAmount && (
        <div className="coupon-amount">{offer.rewardAmount}</div>
      )}
    </div>
  );
}
