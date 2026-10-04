#include "event_queue.h"

namespace agentctl
{

void EventQueue::Clear()
{
    head_    = 0;
    size_    = 0;
    dropped_ = 0;
}

bool EventQueue::Push(const QueuedInput& event)
{
    bool dropped = false;
    if(size_ == kCapacity)
    {
        head_ = (head_ + 1) % kCapacity;
        --size_;
        ++dropped_;
        dropped = true;
    }
    items_[(head_ + size_) % kCapacity] = event;
    ++size_;
    return dropped;
}

bool EventQueue::MergeTurnIntoTail(uint8_t control, int8_t delta)
{
    if(size_ == 0)
        return false;
    QueuedInput& tail = items_[(head_ + size_ - 1) % kCapacity];
    if(tail.kind != InputKind::Turn || tail.control != control)
        return false;
    if((tail.delta > 0) != (delta > 0))
        return false;
    const int sum = tail.delta + delta;
    if(sum > 127 || sum < -127)
        return false;
    tail.delta = static_cast<int8_t>(sum);
    return true;
}

bool EventQueue::Pop(QueuedInput* out)
{
    if(size_ == 0)
        return false;
    *out  = items_[head_];
    head_ = (head_ + 1) % kCapacity;
    --size_;
    return true;
}

bool EventQueue::ContainsControl(uint8_t control) const
{
    for(size_t i = 0; i < size_; ++i)
        if(items_[(head_ + i) % kCapacity].control == control)
            return true;
    return false;
}

} // namespace agentctl
