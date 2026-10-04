#include "json.h"

#include <cctype>
#include <fstream>
#include <sstream>

namespace json
{
namespace
{
class Parser
{
  public:
    explicit Parser(const std::string& text) : text_(text) {}

    Value ParseDocument()
    {
        Value v = ParseValue();
        SkipSpace();
        if(pos_ != text_.size())
            Error("trailing characters");
        return v;
    }

  private:
    [[noreturn]] void Error(const char* what) const
    {
        throw std::runtime_error(std::string("json: ") + what + " at offset "
                                 + std::to_string(pos_));
    }

    void SkipSpace()
    {
        while(pos_ < text_.size()
              && std::isspace(static_cast<unsigned char>(text_[pos_])))
            ++pos_;
    }

    char Peek()
    {
        SkipSpace();
        if(pos_ >= text_.size())
            Error("unexpected end");
        return text_[pos_];
    }

    void Expect(char c)
    {
        if(Peek() != c)
            Error("unexpected character");
        ++pos_;
    }

    bool Consume(const char* word)
    {
        const std::string w(word);
        if(text_.compare(pos_, w.size(), w) == 0)
        {
            pos_ += w.size();
            return true;
        }
        return false;
    }

    Value ParseValue()
    {
        const char c = Peek();
        Value      v;
        if(c == '{')
        {
            v.kind = Value::Kind::Object;
            ++pos_;
            if(Peek() == '}')
            {
                ++pos_;
                return v;
            }
            while(true)
            {
                if(Peek() != '"')
                    Error("expected key");
                const std::string key = ParseString();
                Expect(':');
                v.object[key] = ParseValue();
                if(Peek() == ',')
                {
                    ++pos_;
                    continue;
                }
                Expect('}');
                return v;
            }
        }
        if(c == '[')
        {
            v.kind = Value::Kind::Array;
            ++pos_;
            if(Peek() == ']')
            {
                ++pos_;
                return v;
            }
            while(true)
            {
                v.array.push_back(ParseValue());
                if(Peek() == ',')
                {
                    ++pos_;
                    continue;
                }
                Expect(']');
                return v;
            }
        }
        if(c == '"')
        {
            v.kind   = Value::Kind::String;
            v.string = ParseString();
            return v;
        }
        if(c == '-' || std::isdigit(static_cast<unsigned char>(c)))
        {
            v.kind = Value::Kind::Number;
            bool negative = false;
            if(c == '-')
            {
                negative = true;
                ++pos_;
            }
            if(pos_ >= text_.size()
               || !std::isdigit(static_cast<unsigned char>(text_[pos_])))
                Error("expected digit");
            int64_t n = 0;
            while(pos_ < text_.size()
                  && std::isdigit(static_cast<unsigned char>(text_[pos_])))
                n = n * 10 + (text_[pos_++] - '0');
            if(pos_ < text_.size()
               && (text_[pos_] == '.' || text_[pos_] == 'e'
                   || text_[pos_] == 'E'))
                Error("only integers are supported");
            v.number = negative ? -n : n;
            return v;
        }
        if(Consume("true"))
        {
            v.kind    = Value::Kind::Bool;
            v.boolean = true;
            return v;
        }
        if(Consume("false"))
        {
            v.kind = Value::Kind::Bool;
            return v;
        }
        if(Consume("null"))
            return v;
        Error("unexpected token");
    }

    std::string ParseString()
    {
        Expect('"');
        std::string out;
        while(true)
        {
            if(pos_ >= text_.size())
                Error("unterminated string");
            const char c = text_[pos_++];
            if(c == '"')
                return out;
            if(c != '\\')
            {
                out.push_back(c);
                continue;
            }
            if(pos_ >= text_.size())
                Error("bad escape");
            const char e = text_[pos_++];
            switch(e)
            {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'n': out.push_back('\n'); break;
                case 't': out.push_back('\t'); break;
                case 'r': out.push_back('\r'); break;
                default: Error("unsupported escape");
            }
        }
    }

    const std::string& text_;
    size_t             pos_ = 0;
};
} // namespace

bool Value::Has(const std::string& key) const
{
    return kind == Kind::Object && object.count(key) != 0;
}

const Value& Value::operator[](const std::string& key) const
{
    if(!Has(key))
        throw std::runtime_error("json: missing key " + key);
    return object.at(key);
}

const Value& Value::operator[](size_t index) const
{
    if(kind != Kind::Array || index >= array.size())
        throw std::runtime_error("json: index out of range");
    return array[index];
}

size_t Value::size() const
{
    return kind == Kind::Array ? array.size()
                               : (kind == Kind::Object ? object.size() : 0);
}

Value Parse(const std::string& text) { return Parser(text).ParseDocument(); }

Value ParseFile(const std::string& path)
{
    std::ifstream in(path, std::ios::binary);
    if(!in)
        throw std::runtime_error("json: cannot open " + path);
    std::ostringstream s;
    s << in.rdbuf();
    return Parse(s.str());
}

} // namespace json
