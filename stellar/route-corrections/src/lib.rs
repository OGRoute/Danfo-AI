#![no_std]
//! RouteCorrections — community-owned transit knowledge registry for DanfoAI,
//! rebuilt as a Soroban (Stellar) smart contract.
//!
//! Users submit corrections to danfo/BRT route data (updated fares, new
//! connections, closures). Each correction is recorded on Stellar, making the
//! knowledge base auditable and community-owned. The full payload can live
//! off-chain (e.g. 0G Storage / IPFS) with only its hash anchored here.
//!
//! This mirrors the original Solidity `RouteCorrections` contract:
//!   submit -> upvote -> total / recent / get, plus per-contributor counts.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, String, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Correction {
    pub contributor: Address,
    pub from_stop: String,
    pub to_stop: String,
    pub detail: String,
    pub storage_hash: String, // optional off-chain payload hash
    pub timestamp: u64,
    pub upvotes: u32,
}

#[contracttype]
pub enum DataKey {
    Count,                   // u32: total corrections
    Correction(u32),         // id -> Correction
    Voted(u32, Address),     // (id, voter) -> bool (prevents double-voting)
    Contributions(Address),  // address -> u32 (simple reputation)
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    BadId = 1,
    AlreadyVoted = 2,
}

#[contract]
pub struct RouteCorrections;

#[contractimpl]
impl RouteCorrections {
    /// Submit a route correction. `contributor` must authorize the call.
    /// Returns the new correction id.
    pub fn submit(
        env: Env,
        contributor: Address,
        from_stop: String,
        to_stop: String,
        detail: String,
        storage_hash: String,
    ) -> u32 {
        contributor.require_auth();
        let s = env.storage().persistent();
        let id: u32 = s.get(&DataKey::Count).unwrap_or(0);

        let correction = Correction {
            contributor: contributor.clone(),
            from_stop: from_stop.clone(),
            to_stop: to_stop.clone(),
            detail,
            storage_hash,
            timestamp: env.ledger().timestamp(),
            upvotes: 0,
        };
        s.set(&DataKey::Correction(id), &correction);
        s.set(&DataKey::Count, &(id + 1));

        let contrib: u32 = s
            .get(&DataKey::Contributions(contributor.clone()))
            .unwrap_or(0);
        s.set(&DataKey::Contributions(contributor.clone()), &(contrib + 1));

        env.events().publish(
            (symbol_short!("submit"), contributor),
            (id, from_stop, to_stop),
        );
        id
    }

    /// Upvote a correction. Each address can vote at most once per correction.
    pub fn upvote(env: Env, voter: Address, id: u32) {
        voter.require_auth();
        let s = env.storage().persistent();
        let count: u32 = s.get(&DataKey::Count).unwrap_or(0);
        if id >= count {
            panic_with_error!(&env, Error::BadId);
        }
        let voted_key = DataKey::Voted(id, voter.clone());
        if s.get::<_, bool>(&voted_key).unwrap_or(false) {
            panic_with_error!(&env, Error::AlreadyVoted);
        }
        s.set(&voted_key, &true);

        let mut c: Correction = s.get(&DataKey::Correction(id)).unwrap();
        c.upvotes += 1;
        s.set(&DataKey::Correction(id), &c);

        env.events()
            .publish((symbol_short!("upvote"), voter), (id, c.upvotes));
    }

    /// Total number of corrections recorded.
    pub fn total(env: Env) -> u32 {
        env.storage().persistent().get(&DataKey::Count).unwrap_or(0)
    }

    /// Number of corrections submitted by an address (simple reputation).
    pub fn contributions(env: Env, who: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Contributions(who))
            .unwrap_or(0)
    }

    /// Fetch a single correction by id.
    pub fn get(env: Env, id: u32) -> Correction {
        env.storage()
            .persistent()
            .get(&DataKey::Correction(id))
            .unwrap()
    }

    /// The most recent `n` corrections, newest first.
    pub fn recent(env: Env, n: u32) -> Vec<Correction> {
        let s = env.storage().persistent();
        let count: u32 = s.get(&DataKey::Count).unwrap_or(0);
        let n = if n > count { count } else { n };
        let mut out = Vec::new(&env);
        let mut i = 0u32;
        while i < n {
            let id = count - 1 - i;
            let c: Correction = s.get(&DataKey::Correction(id)).unwrap();
            out.push_back(c);
            i += 1;
        }
        out
    }
}

mod test;
