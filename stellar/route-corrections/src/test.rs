#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, RouteCorrectionsClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RouteCorrections, ());
    let client = RouteCorrectionsClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn submit_increments_and_records() {
    let (env, client) = setup();
    let user = Address::generate(&env);

    let id = client.submit(
        &user,
        &String::from_str(&env, "CMS"),
        &String::from_str(&env, "Oshodi"),
        &String::from_str(&env, "Fare now 400 naira, danfo only"),
        &String::from_str(&env, ""),
    );

    assert_eq!(id, 0);
    assert_eq!(client.total(), 1);
    assert_eq!(client.contributions(&user), 1);

    let c = client.get(&0);
    assert_eq!(c.from_stop, String::from_str(&env, "CMS"));
    assert_eq!(c.to_stop, String::from_str(&env, "Oshodi"));
    assert_eq!(c.upvotes, 0);
}

#[test]
fn recent_returns_newest_first() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    for i in 0..3u32 {
        let _ = i;
        client.submit(
            &user,
            &String::from_str(&env, "A"),
            &String::from_str(&env, "B"),
            &String::from_str(&env, "d"),
            &String::from_str(&env, ""),
        );
    }
    let recent = client.recent(&2);
    assert_eq!(recent.len(), 2);
    // newest id (2) first
    let ts_first = recent.get(0).unwrap();
    assert_eq!(ts_first.upvotes, 0);
    assert_eq!(client.total(), 3);
}

#[test]
fn upvote_counts_once_per_voter() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    let voter = Address::generate(&env);
    client.submit(
        &user,
        &String::from_str(&env, "A"),
        &String::from_str(&env, "B"),
        &String::from_str(&env, "d"),
        &String::from_str(&env, ""),
    );
    client.upvote(&voter, &0);
    assert_eq!(client.get(&0).upvotes, 1);
}

#[test]
#[should_panic]
fn double_vote_panics() {
    let (env, client) = setup();
    let user = Address::generate(&env);
    let voter = Address::generate(&env);
    client.submit(
        &user,
        &String::from_str(&env, "A"),
        &String::from_str(&env, "B"),
        &String::from_str(&env, "d"),
        &String::from_str(&env, ""),
    );
    client.upvote(&voter, &0);
    client.upvote(&voter, &0);
}

#[test]
#[should_panic]
fn upvote_bad_id_panics() {
    let (env, client) = setup();
    let voter = Address::generate(&env);
    client.upvote(&voter, &99);
}
