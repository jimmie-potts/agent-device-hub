// Bounded event queue and epoch tests.
#include "core/epoch.h"
#include "core/event_queue.h"
#include "test.h"

using namespace agentctl;

namespace
{
QueuedInput Press(uint16_t seq, uint8_t control)
{
    return QueuedInput{seq, control, InputKind::Press, 0};
}
} // namespace

TEST("queue: first in, first out")
{
    EventQueue q;
    CHECK(q.Empty());
    CHECK(!q.Push(Press(1, 1)));
    CHECK(!q.Push(Press(2, 2)));
    QueuedInput out{};
    REQUIRE(q.Pop(&out));
    CHECK_EQ(out.sequence, 1);
    REQUIRE(q.Pop(&out));
    CHECK_EQ(out.sequence, 2);
    CHECK(!q.Pop(&out));
}

TEST("queue: overflow drops the oldest and stays bounded")
{
    EventQueue q;
    for(uint16_t i = 1; i <= EventQueue::kCapacity; ++i)
        CHECK(!q.Push(Press(i, 1)));
    CHECK_EQ(q.Size(), EventQueue::kCapacity);
    CHECK(q.Push(Press(100, 2)));
    CHECK(q.Push(Press(101, 3)));
    CHECK_EQ(q.Size(), EventQueue::kCapacity);
    CHECK_EQ(q.dropped(), 2u);
    QueuedInput out{};
    REQUIRE(q.Pop(&out));
    CHECK_EQ(out.sequence, 3); // 1 and 2 were dropped
    size_t n = 1;
    while(q.Pop(&out))
        ++n;
    CHECK_EQ(n, EventQueue::kCapacity);
    CHECK_EQ(out.sequence, 101);
}

TEST("queue: clear empties and resets the drop count")
{
    EventQueue q;
    for(uint16_t i = 0; i < 40; ++i)
        q.Push(Press(i, 1));
    q.Clear();
    CHECK(q.Empty());
    CHECK_EQ(q.dropped(), 0u);
    CHECK(!q.ContainsControl(1));
}

TEST("queue: turns merge only into a matching tail")
{
    EventQueue q;
    CHECK(!q.MergeTurnIntoTail(41, 1)); // empty
    q.Push(QueuedInput{1, 41, InputKind::Turn, 1});
    CHECK(q.MergeTurnIntoTail(41, 1));
    CHECK(!q.MergeTurnIntoTail(41, -1)); // direction change
    CHECK(!q.MergeTurnIntoTail(42, 1));  // other encoder
    q.Push(QueuedInput{2, 41, InputKind::Turn, 126});
    CHECK(q.MergeTurnIntoTail(41, 1));
    CHECK(!q.MergeTurnIntoTail(41, 1)); // would exceed 127
    q.Push(Press(3, 29));
    CHECK(!q.MergeTurnIntoTail(41, 1)); // tail is not a turn
    QueuedInput out{};
    REQUIRE(q.Pop(&out));
    CHECK_EQ(out.delta, 2);
    REQUIRE(q.Pop(&out));
    CHECK_EQ(out.delta, 127);
}

TEST("queue: contains control")
{
    EventQueue q;
    q.Push(Press(1, 5));
    q.Push(QueuedInput{2, 7, InputKind::Release, 0});
    CHECK(q.ContainsControl(5));
    CHECK(q.ContainsControl(7));
    CHECK(!q.ContainsControl(6));
}

TEST("epoch: nonzero and different from the previous one")
{
    CHECK_EQ(NextEpoch(0, 0x00001234u), 0x1234);
    CHECK_EQ(NextEpoch(0x1234, 0xABCD1234u), 0xABCD); // low half repeats
    CHECK_EQ(NextEpoch(0, 0x56780000u), 0x5678);      // low half zero
    CHECK_EQ(NextEpoch(7, 0x00000000u), 8);           // all zero
    CHECK_EQ(NextEpoch(0xFFFF, 0xFFFFFFFFu), 1);      // wraps past zero
    for(uint32_t r = 0; r < 70000; r += 7)
    {
        const uint16_t prev = static_cast<uint16_t>(r * 31u);
        const uint16_t e    = NextEpoch(prev, r * 2654435761u);
        CHECK(e != 0);
        CHECK(e != prev);
    }
}
