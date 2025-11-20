/// Module: groups
/// Manages rooms and circles (group types) on-chain
module ynx_backend::groups {
    use sui::event;
    use std::string;
    use std::string::String;

    // Group types
    const GROUP_ROOM: u8 = 0;
    const GROUP_CIRCLE: u8 = 1;

    /// Group object representing a room or circle
    public struct Group has key, store {
        id: sui::object::UID,
        group_type: u8,
        name: String,
        members: vector<String>,
        created_at: u64,
    }

    /// Event emitted when a group is created
    public struct GroupCreated has copy, drop {
        group_id: address,
        group_type: u8,
        name: String,
        creator: address,
        timestamp: u64,
    }

    /// Event emitted when a member joins
    public struct MemberJoined has copy, drop {
        group_id: address,
        member_id: String,
        timestamp: u64,
    }

    /// Create a new group (room or circle)
    /// Returns the Group object which gets its ID from Sui
    public entry fun create_group(
        group_type: u8,
        name: String,
        ctx: &mut sui::tx_context::TxContext
    ) {
        assert!(is_valid_group_type(group_type), 1);

        let sender = sui::tx_context::sender(ctx);
        let timestamp = sui::tx_context::epoch_timestamp_ms(ctx);

        let name_bytes = string::into_bytes(name);
        let stored_name = string::utf8(copy_bytes(&name_bytes));
        let event_name = string::utf8(name_bytes);

        let group = Group {
            id: sui::object::new(ctx),
            group_type,
            name: stored_name,
            members: vector::empty(),
            created_at: timestamp,
        };

        let group_id = sui::object::uid_to_address(&group.id);

        event::emit(GroupCreated {
            group_id,
            group_type,
            name: event_name,
            creator: sender,
            timestamp,
        });

        // Transfer Group object to creator (they own it and can share/manage it)
        sui::transfer::public_transfer(group, sender);
    }

    /// Join an existing group
    /// Requires mutable reference to the Group object
    public entry fun join_group(
        group: &mut Group,
        member_id: String,
        ctx: &mut sui::tx_context::TxContext
    ) {
        let timestamp = sui::tx_context::epoch_timestamp_ms(ctx);
        let member_bytes = string::into_bytes(member_id);
        let stored_member = string::utf8(copy_bytes(&member_bytes));
        let event_member = string::utf8(member_bytes);

        // Add member to the group's member list
        vector::push_back(&mut group.members, stored_member);

        event::emit(MemberJoined {
            group_id: sui::object::uid_to_address(&group.id),
            member_id: event_member,
            timestamp,
        });
    }

    /// Get group info (for queries)
    public fun get_group_type(group_ref: &Group): u8 {
        group_ref.group_type
    }

    public fun get_group_name(group_ref: &Group): String {
        group_ref.name
    }

    public fun get_member_count(group_ref: &Group): u64 {
        vector::length(&group_ref.members)
    }

    fun is_valid_group_type(group_type: u8): bool {
        group_type == GROUP_ROOM || group_type == GROUP_CIRCLE
    }

    fun copy_bytes(vec: &vector<u8>): vector<u8> {
        let len = vector::length(vec);
        let mut copied = vector::empty<u8>();
        let mut i = 0;
        while (i < len) {
            let byte_ref = vector::borrow(vec, i);
            vector::push_back(&mut copied, *byte_ref);
            i = i + 1;
        };
        copied
    }
}
