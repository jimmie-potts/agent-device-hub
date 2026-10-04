// Bounded queue of input events waiting for the USB IN endpoint.
#pragma once

#include <cstddef>
#include <cstdint>

#include "protocol.h"

namespace agentctl
{

struct QueuedInput
{
    uint16_t  sequence;
    uint8_t   control;
    InputKind kind;
    int8_t    delta;
};

class EventQueue
{
  public:
    static constexpr size_t kCapacity = 32;

    void   Clear();
    bool   Empty() const { return size_ == 0; }
    size_t Size() const { return size_; }

    // Appends an event. When full, the oldest event is dropped first and the
    // call returns true.
    bool Push(const QueuedInput& event);

    // Adds `delta` to the newest queued event when it is a turn of the same
    // control in the same direction and the sum fits in a signed byte.
    bool MergeTurnIntoTail(uint8_t control, int8_t delta);

    bool Pop(QueuedInput* out);
    bool ContainsControl(uint8_t control) const;

    // Events dropped by overflow since the last Clear().
    uint32_t dropped() const { return dropped_; }

  private:
    QueuedInput items_[kCapacity];
    size_t      head_    = 0;
    size_t      size_    = 0;
    uint32_t    dropped_ = 0;
};

} // namespace agentctl
