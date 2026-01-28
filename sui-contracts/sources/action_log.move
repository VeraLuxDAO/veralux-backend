/// Module: action_log
/// Logs actions (FLOW, GLOW, PROMOTE, CHAT, etc.) on-chain with Walrus hash references
module ynx_backend::action_log {
    use sui::event;
    use std::string::String;

    // Action types enum (u8)
    const ACTION_FLOW: u8 = 0;
    const ACTION_GLOW: u8 = 1;
    const ACTION_PROMOTE: u8 = 2;
    const ACTION_CHAT: u8 = 3;
    const ACTION_GROUP_CREATE: u8 = 4;
    const ACTION_GROUP_JOIN: u8 = 5;

    /// Event emitted when an action is logged
    public struct ActionLogged has copy, drop {
        action_type: u8,
        walrus_hash: String,
        actor_id: String,
        timestamp: u64,
    }

    /// Public entry function to log an action
    /// Called from the backend with action type, walrus hash, and optional actor ID
    public entry fun log_action(
        action_type: u8,
        walrus_hash: String,
        actor_id: String,
        ctx: &mut sui::tx_context::TxContext
    ) {
        assert!(!is_invalid_action(action_type), 0);

        // Emit event for verification later
        event::emit(ActionLogged {
            action_type,
            walrus_hash,
            actor_id,
            timestamp: sui::tx_context::epoch_timestamp_ms(ctx),
        });
    }

    fun is_invalid_action(action_type: u8): bool {
        !(action_type == ACTION_FLOW
            || action_type == ACTION_GLOW
            || action_type == ACTION_PROMOTE
            || action_type == ACTION_CHAT
            || action_type == ACTION_GROUP_CREATE
            || action_type == ACTION_GROUP_JOIN)
    }
}
