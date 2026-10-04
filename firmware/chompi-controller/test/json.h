// A small JSON reader for the protocol fixtures. It accepts objects, arrays,
// strings (with simple escapes), integers, true, false and null.
#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace json
{

struct Value
{
    enum class Kind
    {
        Null,
        Bool,
        Number,
        String,
        Array,
        Object,
    };

    Kind                         kind = Kind::Null;
    bool                         boolean = false;
    int64_t                      number = 0;
    std::string                  string;
    std::vector<Value>           array;
    std::map<std::string, Value> object;

    bool         Has(const std::string& key) const;
    const Value& operator[](const std::string& key) const;
    const Value& operator[](size_t index) const;
    size_t       size() const;
};

// Throws std::runtime_error with the offset of the first syntax error.
Value Parse(const std::string& text);
Value ParseFile(const std::string& path);

} // namespace json
